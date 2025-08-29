import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { OTelLogger } from "../OTelContext";
import {
  SyncFileCacheCheckFile,
  SyncFileCacheRemoveFile,
} from "../sync/SyncFileCache";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { FileDataGet } from "./FileData";

const logger = OTelLogger().createModuleLogger("FileOperationsDeleteRoutes");

export class RoutesFileOperationsRebuildCache {
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
        try {
          const account = await AccountFactoryGetAccountImplementation(
            req.params.accountId
          );
          for (const fileId of req.body.fileIdList) {
            const file = await FileDataGet(span, fileId);
            if (!file) {
              continue;
            }
            await SyncFileCacheRemoveFile(span, account, file);
            SyncFileCacheCheckFile(span, account, file);
          }
        } catch (err) {
          logger.error(err);
        }
      }, 50);

      return res.status(202).send({});
    });
  }
}
