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

const logger = OTelLogger().createModuleLogger("FileOperationsRenameRoutes");

export class RoutesFileOperationsRename {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fileIdNames: any[];
      };
    }
    fastify.post<PostFilesRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdNames || req.body.fileIdNames.length === 0) {
        return res
          .status(400)
          .send({ error: "Missing parameter: fileIdNames" });
      }

      setTimeout(async () => {
        SyncQueueSetBlockingOperationStart();
        const spanSubProcess = OTelTracer().startSpan(
          "RoutesFileOperationsRenameFile_post_process"
        );
        try {
          let folderId = "";
          const account = await AccountFactoryGetAccountImplementation(
            req.params.accountId
          );
          for (const fileIdName of req.body.fileIdNames) {
            const file = await FileDataGet(spanSubProcess, fileIdName.id);
            if (!file) {
              continue;
            }
            folderId = file.folderId;
            await account.renameFile(spanSubProcess, file, fileIdName.filename);
          }
          if (folderId) {
            const folder = await FolderDataGet(spanSubProcess, folderId);
            await SyncInventorySyncFolder(account, folder);
          }
        } catch (err) {
          logger.error("Error Renaming File", err, spanSubProcess);
        }
        SyncQueueSetBlockingOperationEnd();
        spanSubProcess.end();
      }, 50);

      return res.status(201).send({});
    });
  }
}
