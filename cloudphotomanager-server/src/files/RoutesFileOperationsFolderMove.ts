import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { FolderDataGet } from "../folders/FolderData";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import {
  SyncQueueSetBlockingOperationEnd,
  SyncQueueSetBlockingOperationStart,
} from "../sync/SyncQueue";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { FileDataGet } from "./FileData";

const logger = OTelLogger().createModuleLogger(
  "FileOperationsFolderMoveRoutes"
);

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
        const spanSubProcess = OTelTracer().startSpan(
          "RoutesFileOperationsFolderMove_postFiles_process"
        );
        SyncQueueSetBlockingOperationStart();
        try {
          let initialFolderId = "";
          const account = await AccountFactoryGetAccountImplementation(
            req.params.accountId
          );
          for (const fileId of req.body.fileIdList) {
            const file = await FileDataGet(spanSubProcess, fileId);
            if (!file) {
              continue;
            }
            initialFolderId = file.folderId;
            logger.info(
              `Moving file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename} to ${req.body.folderpath}`,
              spanSubProcess
            );
            await account.moveFile(spanSubProcess, file, req.body.folderpath);
          }
          const initialFolder = await FolderDataGet(
            spanSubProcess,
            initialFolderId
          );
          await SyncInventorySyncFolder(account, initialFolder);
          const targetFolder = await account.getFolderByPath(
            spanSubProcess,
            req.body.folderpath
          );
          await SyncInventorySyncFolder(account, targetFolder);
        } catch (err) {
          logger.error("Error Moving File", err, spanSubProcess);
        }
        SyncQueueSetBlockingOperationEnd();
        spanSubProcess.end();
      }, 50);

      return res.status(201).send({});
    });
  }
}
