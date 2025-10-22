import { Span } from "@opentelemetry/sdk-trace-base";
import * as path from "path";
import { readdir, stat } from "fs-extra";
import { Folder } from "../../model/Folder";
import { LocalAccount } from "./LocalDriveAccount";
import { File } from "../../model/File";
import * as fs from "fs";
import * as crypto from "crypto";

const dateEmptyFolder = new Date("1900-01-01 00:00:00");

export async function LocalAccountInventoryGetFolder(
  context: Span,
  localAccount: LocalAccount,
  folder: Folder
): Promise<Folder> {
  return LocalAccountInventoryGetFolderByPath(
    context,
    localAccount,
    folder.folderpath
  );
}

export async function LocalAccountInventoryGetFolderByPath(
  context: Span,
  localAccount: LocalAccount,
  folderpath: string
): Promise<Folder> {
  const folder = new Folder(localAccount.getAccountDefinition().id, folderpath);
  folder.idCloud = path.join(
    localAccount.getAccountDefinition().rootpath,
    folderpath
  );
  folder.folderpath = folderpath;
  folder.dateSync = new Date();
  folder.dateUpdated = dateEmptyFolder;
  const items = await readdir(folder.idCloud);
  for (const item of items) {
    const stats = await stat(path.join(folder.idCloud, item));
    if (!stats.isDirectory()) {
      if (folder.dateUpdated < new Date(stats.mtimeMs)) {
        folder.dateUpdated = new Date(stats.mtimeMs);
      }
    }
  }
  return folder;
}

export async function LocalAccountInventoryListFoldersInFolder(
  context: Span,
  localAccount: LocalAccount,
  folder: Folder
): Promise<Folder[]> {
  const folders: Folder[] = [];
  const items = await readdir(folder.idCloud);
  for (const item of items) {
    const stats = await stat(path.join(folder.idCloud, item));
    if (stats.isDirectory()) {
      folders.push(
        await LocalAccountInventoryGetFolderByPath(
          context,
          localAccount,
          path.join(folder.folderpath, item)
        )
      );
    }
  }
  return folders;
}

async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function LocalAccountInventoryListFilesInFolder(
  context: Span,
  localAccount: LocalAccount,
  folder: Folder
): Promise<File[]> {
  const files: File[] = [];
  const items = await readdir(folder.idCloud);
  for (const item of items) {
    const stats = await stat(path.join(folder.idCloud, item));
    if (!stats.isDirectory()) {
      const stats = await stat(path.join(folder.idCloud, item));
      const file = new File(
        localAccount.getAccountDefinition().id,
        folder.id,
        item
      );
      file.dateSync = new Date();
      file.dateUpdated = new Date(stats.mtimeMs);
      file.idCloud = path.join(folder.idCloud, item);
      file.hash = await calculateFileHash(file.idCloud);
      files.push(file);
    }
  }
  return files;
}
