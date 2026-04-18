import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelLogger } from "../OTelContext";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";

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
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdNames || req.body.fileIdNames.length === 0) {
        return res
          .status(400)
          .send({ error: "Missing parameter: fileIdNames" });
      }

      const accountId = req.params.accountId;
      for (const fileIdName of req.body.fileIdNames) {
        SyncQueueQueueItem(
          accountId,
          `fileRename:${accountId}:${fileIdName.id}`,
          { fileId: fileIdName.id, filename: fileIdName.filename },
          "fileRename",
          SyncQueueItemPriority.INTERACTIVE,
          [fileIdName.id],
        );
      }

      return res.status(201).send({});
    });
  }
}
