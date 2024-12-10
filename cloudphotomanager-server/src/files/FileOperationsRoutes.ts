import { FastifyInstance, RequestGenericInterface } from "fastify";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import { FolderDataGet } from "../folders/FolderData";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { FileDataDelete, FileDataGet } from "./FileData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";

const logger = new Logger("FileOperationsRoutes");
export class FileOperationsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
      Body: {
        folderpath: string;
      };
    }
    fastify.put<PostFilesAccountIdRequest>("/folder", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.folderpath) {
        return res.status(400).send({ error: "Missing parameter: folderpath" });
      }
      const file = await FileDataGet(span, req.params.fileId);
      if (!file) {
        return res.status(404).send({ error: "File not found" });
      }
      const account = await AccountFactoryGetAccountImplementation(req.params.accountId);
      await account.moveFile(span, file, req.body.folderpath);

      // Sync
      await FileDataDelete(span, file.id);
      FolderDataGet(span, file.folderId)
        .then((folder) => {
          SyncQueueQueueItem(
            account,
            folder.id,
            folder,
            SyncInventorySyncFolder,
            SyncQueueItemPriority.INTERACTIVE_BLOCKING
          );
        })
        .catch((err) => {
          logger.error(err);
        });

      account
        .getFolderByPath(span, req.body.folderpath)
        .then((folder) => {
          SyncQueueQueueItem(
            account,
            folder.id,
            folder,
            SyncInventorySyncFolder,
            SyncQueueItemPriority.INTERACTIVE_BLOCKING
          );
        })
        .catch((err) => {
          logger.error(err);
        });

      return res.status(201).send({});
    });

    interface DeleteFilesAccountIdFileId extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.delete<DeleteFilesAccountIdFileId>("/delete", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const file = await FileDataGet(span, req.params.fileId);
      if (!file) {
        return res.status(404).send({ error: "File Not Found" });
      }

      const account = await AccountFactoryGetAccountImplementation(req.params.accountId);
      await account.deleteFile(span, file);
      await FileDataDelete(span, file.id);

      FolderDataGet(span, file.folderId)
        .then(async (folder) => {
          SyncQueueQueueItem(
            account,
            file.folderId,
            folder,
            SyncInventorySyncFolder,
            SyncQueueItemPriority.INTERACTIVE_BLOCKING
          );
        })
        .catch((err) => {
          logger.error(err);
        });

      return res.status(202).send({});
    });
  }
}
