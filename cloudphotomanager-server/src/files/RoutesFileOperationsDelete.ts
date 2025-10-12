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

const logger = OTelLogger().createModuleLogger("FileOperationsDeleteRoutes");

export class RoutesFileOperationsDelete {
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
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }

      setTimeout(async () => {
        const spanSubProcess = OTelTracer().startSpan(
          "RoutesFileOperationsDelete_postFiles_process"
        );
        SyncQueueSetBlockingOperationStart();
        try {
          let folderId = "";
          const account = await AccountFactoryGetAccountImplementation(
            req.params.accountId
          );
          for (const fileId of req.body.fileIdList) {
            const file = await FileDataGet(spanSubProcess, fileId);
            if (!file) {
              continue;
            }
            folderId = file.folderId;
            await account.deleteFile(spanSubProcess, file);
          }
          if (folderId) {
            const folder = await FolderDataGet(spanSubProcess, folderId);
            await SyncInventorySyncFolder(account, folder);
          }
        } catch (err) {
          logger.error("Error Removing File from Account", err, spanSubProcess);
        }
        SyncQueueSetBlockingOperationEnd();
        spanSubProcess.end();
      }, 50);

      return res.status(202).send({});
    });
  }
}
