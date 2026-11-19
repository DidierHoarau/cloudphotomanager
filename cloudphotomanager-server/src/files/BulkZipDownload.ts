import { Archiver, ZipArchive } from "archiver";
import { Span } from "@opentelemetry/sdk-trace";
import * as fs from "fs-extra";
import * as path from "path";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { OTelLogger } from "../OTelContext";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { FileDataGetFileTmpDir } from "./FileData";
import {
  FileNameValidate,
  FolderPathValidate,
  PathIsInsideRoot,
  ZipEntryNameValidate,
} from "./PathValidation";

const logger = OTelLogger().createModuleLogger("BulkZipDownload");

// Bounds the request against the reverse-proxy timeout: the zip is streamed
// while originals are downloaded one by one from the cloud account.
export const MAX_BULK_DOWNLOAD_FILES = 500;

export interface BulkZipItem {
  file: File;
  folder: Folder;
  entryName: string;
}

export interface BulkZipFailure {
  status: number;
  error: string;
}

// Authenticated download naming: path relative to the account root.
export function BulkZipEntryNameAccount(folder: Folder, file: File): string {
  return folder.folderpath === "/"
    ? file.filename
    : `${folder.folderpath.replace(/^\/+/, "")}/${file.filename}`;
}

// Folder-share naming: path relative to the shared root, so no ancestor
// folder name leaks. Returns null when the folder is outside the subtree.
export function BulkZipEntryNameSharedRoot(
  sharedFolderpath: string,
  folder: Folder,
  file: File,
): string | null {
  if (sharedFolderpath === "/") {
    return file.filename;
  }
  if (folder.folderpath === sharedFolderpath) {
    return file.filename;
  }
  const prefix = `${sharedFolderpath}/`;
  if (!folder.folderpath.startsWith(prefix)) {
    return null;
  }
  return `${folder.folderpath.slice(prefix.length)}/${file.filename}`;
}

// Album/single-file naming: last folder segment + filename. No folder tree is
// exposed through an album share.
export function BulkZipEntryNameBasename(folder: Folder, file: File): string {
  const segment = folder.folderpath.split("/").filter(Boolean).pop();
  return segment ? `${segment}/${file.filename}` : file.filename;
}

// Appends " (2)", " (3)", ... before the extension to entries whose
// last-segment names collide (two folders with the same name in one album).
export function BulkZipDedupeNames(items: BulkZipItem[]): BulkZipItem[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const key = item.entryName.toLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count === 0) {
      return item;
    }
    const slash = item.entryName.lastIndexOf("/");
    const dir = slash >= 0 ? item.entryName.substring(0, slash + 1) : "";
    const base = item.entryName.substring(slash + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.substring(0, dot) : base;
    const extension = dot > 0 ? base.substring(dot) : "";
    return {
      ...item,
      entryName: `${dir}${stem} (${count + 1})${extension}`,
    };
  });
}

// Appends one file to the zip and resolves when the entry has actually been
// written, so the caller can download the next file and keep at most one
// original on disk at a time (entries are processed in append order).
function archiveFileAndAwaitEntry(
  archive: Archiver,
  filepath: string,
  entryName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEntry = (entry: { name: string }) => {
      if (entry.name === entryName) {
        cleanup();
        resolve();
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      archive.off("entry", onEntry);
      archive.off("error", onError);
    }
    archive.on("entry", onEntry);
    archive.on("error", onError);
    archive.file(filepath, { name: entryName });
  });
}

// Validates the whole selection, then streams the archive. Validation is
// fail-closed before any byte is sent: provider-side names are untrusted and
// the account must be able to serve originals. Returns a failure object
// (caller sends it) or null once the response is streaming.
export async function BulkZipDownloadFiles(
  context: Span,
  res: any,
  items: BulkZipItem[],
  zipName: string,
): Promise<BulkZipFailure | null> {
  if (!items || items.length === 0) {
    return { status: 400, error: "Missing parameter: fileIdList" };
  }
  if (items.length > MAX_BULK_DOWNLOAD_FILES) {
    return {
      status: 400,
      error: `Too many files (max ${MAX_BULK_DOWNLOAD_FILES})`,
    };
  }
  const accounts = new Map<string, Account>();
  for (const item of items) {
    const { file, folder, entryName } = item;
    if (!file || !folder) {
      return { status: 403, error: "Access Denied" };
    }
    if (FileNameValidate(file.filename) !== null) {
      return { status: 400, error: "Invalid filename in selection" };
    }
    if (FolderPathValidate(folder.folderpath) !== null) {
      return { status: 400, error: "Invalid folder path in selection" };
    }
    if (ZipEntryNameValidate(entryName) !== null) {
      return { status: 400, error: "Invalid entry name in selection" };
    }
    if (!accounts.has(file.accountId)) {
      const account = await AccountFactoryGetAccountImplementation(
        file.accountId,
      );
      accounts.set(file.accountId, account);
    }
    if (!accounts.get(file.accountId).getCapabilities().downloadFileOriginal) {
      return { status: 403, error: "Access Denied" };
    }
  }

  res.header("Content-Type", "application/zip");
  res.header("Content-Disposition", `attachment; filename="${zipName}"`);

  const archive = new ZipArchive();
  archive.on("error", (err) => {
    logger.error("Error Building Zip Archive", err, context);
    res.raw.destroy(err);
  });
  res.send(archive);

  const tmpDirs: string[] = [];
  try {
    for (const item of items) {
      const tmpDir = await FileDataGetFileTmpDir(
        context,
        item.file.accountId,
        item.file.id,
      );
      tmpDirs.push(tmpDir);
      try {
        await fs.ensureDir(tmpDir);
        // The download path is derived from the validated filename; the
        // containment check is defense-in-depth if that validation ever
        // regresses.
        const localPath = path.resolve(tmpDir, item.file.filename);
        if (!PathIsInsideRoot(tmpDir, localPath)) {
          throw new Error("Download path escapes the temp dir");
        }
        const account = accounts.get(item.file.accountId);
        await account.downloadFile(
          context,
          item.file,
          tmpDir,
          item.file.filename,
        );
        await archiveFileAndAwaitEntry(archive, localPath, item.entryName);
      } finally {
        // The entry has been fully written when the helper resolves, so the
        // original can be removed before downloading the next one.
        await fs.remove(tmpDir).catch((err) => {
          logger.error("Error Removing Zip Temp Dir", err, context);
        });
      }
    }
    await archive.finalize();
  } finally {
    for (const tmpDir of tmpDirs) {
      await fs.remove(tmpDir).catch((err) => {
        logger.error("Error Removing Zip Temp Dir", err, context);
      });
    }
  }
  return null;
}
