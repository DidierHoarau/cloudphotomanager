import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelLogger } from "../OTelContext";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import * as md5Lib from "md5";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const md5 = (md5Lib as any).default || md5Lib;

const logger = OTelLogger().createModuleLogger(
  "FileOperationsFolderMoveRoutes",
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

      const accountId = req.params.accountId;
      const fileIdList = req.body.fileIdList;
      const folderpath = req.body.folderpath;
      const queueId = md5(
        `folderMove:${accountId}:${fileIdList.sort().join(",")}:${folderpath}`,
      );

      SyncQueueQueueItem(
        accountId,
        queueId,
        { fileIdList, folderpath },
        "folderMove",
        SyncQueueItemPriority.INTERACTIVE,
        fileIdList,
      );

      return res.status(201).send({});
    });
  }
}
