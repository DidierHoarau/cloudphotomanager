import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { FileDataGet } from "./FileData";
import { FolderDataListForAccount } from "../folders/FolderData";
import { FolderPathValidate } from "./PathValidation";

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
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }
      const folderpathError = FolderPathValidate(req.body.folderpath);
      if (folderpathError) {
        return res.status(400).send({ error: folderpathError });
      }

      const accountId = req.params.accountId;
      const folderpath = req.body.folderpath;

      for (const fileId of req.body.fileIdList) {
        if (typeof fileId !== "string" || fileId.length === 0) {
          return res.status(400).send({ error: "Missing parameter: fileId" });
        }
        const file = await FileDataGet(span, fileId);
        if (!file) {
          return res.status(404).send({ error: "File not found" });
        }
        if (file.accountId !== accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
      }

      const folders = await FolderDataListForAccount(span, accountId);
      if (!folders.find((folder) => folder.folderpath === folderpath)) {
        return res.status(400).send({ error: "Destination folder not found" });
      }

      for (const fileId of req.body.fileIdList) {
        SyncQueueQueueItem(
          accountId,
          `folderMove:${accountId}:${fileId}:${folderpath}`,
          { fileId, folderpath },
          "folderMove",
          SyncQueueItemPriority.INTERACTIVE,
          [fileId],
        );
      }

      return res.status(201).send({});
    });
  }
}
