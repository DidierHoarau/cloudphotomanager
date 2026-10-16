import { FastifyInstance, RequestGenericInterface } from "fastify";
import { FileDataTrash } from "./FileData";
import { SyncQueueBroadcastOperationComplete } from "../sync/SyncQueue";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";

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
    // Moves the files to the Trash (soft delete): the rows stay in the
    // database and the files stay in the cloud storage until the retention
    // purge enqueues the actual cloud fileDelete operations.
    fastify.post<PostFilesRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }

      let trashedCount = 0;
      const trashedFileIds: string[] = [];
      for (const fileId of req.body.fileIdList) {
        const rowsAffected = await FileDataTrash(span, fileId);
        if (rowsAffected > 0) {
          trashedCount += rowsAffected;
          trashedFileIds.push(fileId);
        }
      }
      SyncQueueBroadcastOperationComplete("fileTrash", trashedFileIds);

      return res.status(200).send({ trashed: trashedCount });
    });
  }
}
