import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { FileData } from "./FileData";
import { AccountFactory } from "../accounts/AccountFactory";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import { FolderData } from "../folders/FolderData";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueQueueItem } from "../sync/SyncQueue";

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
      const userSession = await Auth.getUserSession(req);
      if (!Auth.isAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.folderpath) {
        return res.status(400).send({ error: "Missing parameter: folderpath" });
      }
      const file = await FileData.get(span, req.params.fileId);
      if (!file) {
        return res.status(404).send({ error: "File not found" });
      }
      const account = await AccountFactory.getAccountImplementation(req.params.accountId);
      await account.moveFile(span, file, req.body.folderpath);

      // Sync
      await FileData.delete(span, file.id);
      FolderData.get(span, file.folderId)
        .then((folder) => {
          SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.INTERACTIVE);
        })
        .catch((err) => {
          logger.error(err);
        });

      account
        .getFolderByPath(span, req.body.folderpath)
        .then((folder) => {
          SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.INTERACTIVE);
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
      const userSession = await Auth.getUserSession(req);
      if (!Auth.isAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const file = await FileData.get(span, req.params.fileId);
      if (!file) {
        return res.status(404).send({ error: "File Not Found" });
      }

      const account = await AccountFactory.getAccountImplementation(req.params.accountId);
      await account.deleteFile(span, file);
      await FileData.delete(span, file.id);

      FolderData.get(span, file.folderId)
        .then(async (folder) => {
          SyncQueueQueueItem(
            account,
            file.folderId,
            folder,
            SyncInventorySyncFolder,
            SyncQueueItemPriority.INTERACTIVE
          );
        })
        .catch((err) => {
          logger.error(err);
        });

      return res.status(202).send({});
    });
  }
}
