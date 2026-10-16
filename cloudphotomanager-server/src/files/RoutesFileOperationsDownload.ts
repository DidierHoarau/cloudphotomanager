import archiver from "archiver";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import * as fs from "fs-extra";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { OTelLogger } from "../OTelContext";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { FolderDataGet } from "../folders/FolderData";
import { AuthGetUserSession } from "../users/Auth";
import {
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { FileDataGet, FileDataGetFileTmpDir } from "./FileData";

const logger = OTelLogger().createModuleLogger("RoutesFileOperationsDownload");

// Bounds the request against the reverse-proxy timeout: the zip is streamed
// while originals are downloaded one by one from the cloud account.
const MAX_BULK_DOWNLOAD_FILES = 500;

// Appends one file to the zip and resolves when the entry has actually been
// written, so the caller can download the next file and keep at most one
// original on disk at a time (entries are processed in append order).
function archiveFileAndAwaitEntry(
  archive: archiver.Archiver,
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

export class RoutesFileOperationsDownload {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        fileIdList: string[];
      };
    }
    fastify.post<PostFilesRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body?.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }
      if (req.body.fileIdList.length > MAX_BULK_DOWNLOAD_FILES) {
        return res.status(400).send({
          error: `Too many files (max ${MAX_BULK_DOWNLOAD_FILES})`,
        });
      }

      // Fail-closed validation of the whole selection before any byte is
      // streamed: every file must be known, belong to this account, be in a
      // folder the user may access, and sit on an account able to serve
      // originals.
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      const foldersByFileId = new Map<string, any>();
      const accounts = new Map<string, Account>();
      const fileIds = Array.from(new Set(req.body.fileIdList));
      const files: File[] = [];
      for (const fileId of fileIds) {
        const file = await FileDataGet(span, fileId);
        if (!file || file.accountId !== req.params.accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const folder = await FolderDataGet(span, file.folderId);
        if (
          !folder ||
          !UserPermissionContextFolderIsPermitted(permissionContext, {
            id: folder.id,
            accountId: folder.accountId,
            folderpath: folder.folderpath,
          })
        ) {
          return res.status(403).send({ error: "Access Denied" });
        }
        let account = accounts.get(file.accountId);
        if (!account) {
          account = await AccountFactoryGetAccountImplementation(
            file.accountId,
          );
          accounts.set(file.accountId, account);
        }
        if (!account.getCapabilities().downloadFileOriginal) {
          return res.status(403).send({ error: "Access Denied" });
        }
        foldersByFileId.set(file.id, folder);
        files.push(file);
      }

      // Zip entries are named "<relative folder path>/<filename>"; folder
      // paths are unique per folder so entries cannot collide.
      const zipName = `photos-${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .substring(0, 15)}.zip`;
      res.header("Content-Type", "application/zip");
      res.header("Content-Disposition", `attachment; filename="${zipName}"`);

      const archive = archiver("zip");
      archive.on("error", (err) => {
        logger.error("Error Building Zip Archive", err, span);
        res.raw.destroy(err);
      });
      res.send(archive);

      const tmpDirs: string[] = [];
      try {
        for (const file of files) {
          const tmpDir = await FileDataGetFileTmpDir(
            span,
            file.accountId,
            file.id,
          );
          tmpDirs.push(tmpDir);
          await fs.ensureDir(tmpDir);
          const account = accounts.get(file.accountId);
          await account.downloadFile(span, file, tmpDir, file.filename);
          const folder = foldersByFileId.get(file.id);
          const entryName = `${folder.folderpath.replace(/^\//, "")}/${file.filename}`;
          await archiveFileAndAwaitEntry(
            archive,
            `${tmpDir}/${file.filename}`,
            entryName,
          );
        }
        await archive.finalize();
      } finally {
        for (const tmpDir of tmpDirs) {
          await fs.remove(tmpDir).catch((err) => {
            logger.error("Error Removing Zip Temp Dir", err, span);
          });
        }
      }
    });
  }
}
