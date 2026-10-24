import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { FileDataGet } from "./FileData";
import { FileNameValidate } from "./PathValidation";

export class RoutesFileOperationsRename {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
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

      const accountId = req.params.accountId;
      for (const fileIdName of req.body.fileIdNames) {
        if (
          !fileIdName ||
          typeof fileIdName.id !== "string" ||
          fileIdName.id.length === 0
        ) {
          return res.status(400).send({ error: "Missing parameter: id" });
        }
        const filenameError = FileNameValidate(fileIdName.filename);
        if (filenameError) {
          return res.status(400).send({ error: filenameError });
        }
      }

      for (const fileIdName of req.body.fileIdNames) {
        const file = await FileDataGet(span, fileIdName.id);
        if (!file) {
          return res.status(404).send({ error: "File not found" });
        }
        if (file.accountId !== accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
      }

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
