import { FastifyInstance, RequestGenericInterface } from "fastify";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { Logger } from "../utils-std-ts/Logger";
import { FileDataGet } from "./FileData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { SyncFileCacheCheckFile, SyncFileCacheRemoveFile } from "../sync/SyncFileCache";

const logger = new Logger("FileOperationsDeleteRoutes");

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
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }

      setTimeout(async () => {
        try {
          const account = await AccountFactoryGetAccountImplementation(req.params.accountId);
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
