import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelLogger } from "../OTelContext";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";

const logger = OTelLogger().createModuleLogger(
  "FileOperationsRebuildCacheRoutes",
);

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
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }

      const accountId = req.params.accountId;
      for (const fileId of req.body.fileIdList) {
        SyncQueueQueueItem(
          accountId,
          `fileCacheRebuild:${accountId}:${fileId}`,
          { fileId },
          "fileCacheRebuild",
          SyncQueueItemPriority.INTERACTIVE,
          [fileId],
        );
      }

      return res.status(202).send({});
    });
  }
}
