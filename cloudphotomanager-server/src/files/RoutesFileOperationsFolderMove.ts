import { FastifyInstance, RequestGenericInterface } from "fastify";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import { FolderDataGet } from "../folders/FolderData";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueueSetBlockingOperationEnd, SyncQueueSetBlockingOperationStart } from "../sync/SyncQueue";
import { FileDataGet } from "./FileData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";

const logger = new Logger("FileOperationsFolderMoveRoutes");

export class RoutesFileOperationsFolderMove {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        folderpath: string;
        fileIdList: string[];
      };
    }
    fastify.post<PostFilesRequest>("/", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.folderpath) {
        return res.status(400).send({ error: "Missing parameter: folderpath" });
      }
      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }

      setTimeout(async () => {
        SyncQueueSetBlockingOperationStart();
        try {
          let initialFolderId = "";
          const account = await AccountFactoryGetAccountImplementation(req.params.accountId);
          for (const fileId of req.body.fileIdList) {
            const file = await FileDataGet(span, fileId);
            if (!file) {
              continue;
            }
            initialFolderId = file.folderId;
            await account.moveFile(span, file, req.body.folderpath);
          }
          const initialFolder = await FolderDataGet(span, initialFolderId);
          await SyncInventorySyncFolder(account, initialFolder);
          const targetFolder = await account.getFolderByPath(span, req.body.folderpath);
          await SyncInventorySyncFolder(account, targetFolder);
        } catch (err) {
          logger.error(err);
        }
        SyncQueueSetBlockingOperationEnd();
      }, 50);

      return res.status(201).send({});
    });
  }
}
