import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { File } from "../model/File";
import { FolderDataGet } from "../folders/FolderData";
import { AuthGetUserSession } from "../users/Auth";
import {
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { FileDataGet } from "./FileData";
import {
  BulkZipDownloadFiles,
  BulkZipEntryNameAccount,
  BulkZipItem,
  MAX_BULK_DOWNLOAD_FILES,
} from "./BulkZipDownload";

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

      // Fail-closed permission validation of the whole selection before any
      // byte is streamed: every file must be known, belong to this account and
      // sit in a folder the user may access.
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      const fileIds = Array.from(new Set(req.body.fileIdList));
      const items: BulkZipItem[] = [];
      for (const fileId of fileIds) {
        const file: File = await FileDataGet(span, fileId);
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
        items.push({
          file,
          folder,
          entryName: BulkZipEntryNameAccount(folder, file),
        });
      }

      const zipName = `photos-${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .substring(0, 15)}.zip`;
      const failure = await BulkZipDownloadFiles(span, res, items, zipName);
      if (failure) {
        return res.status(failure.status).send({ error: failure.error });
      }
    });
  }
}
