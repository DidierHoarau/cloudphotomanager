import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { Config } from "../Config";
import {
  FileDataGet,
  FileDataListTrashPaginated,
  FileDataRestore,
} from "./FileData";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueBroadcastOperationComplete, SyncQueueQueueItem } from "../sync/SyncQueue";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { PaginationParse } from "../utils-std-ts/Pagination";

export class TrashRoutes {
  //
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    // Fastify invokes getRoutes detached (as a plugin), so `this` must be
    // bound for the route handlers to reach the instance config.
    this.getRoutes = this.getRoutes.bind(this);
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
      };
      Querystring: {
        page?: string;
        pageSize?: string;
      };
    }>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const pagination = PaginationParse(req.query);
      if (!pagination) {
        return res
          .status(400)
          .send({ error: "Invalid parameter: page or pageSize" });
      }
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      const permittedFolderIds = await UserPermissionContextFolderIdsGet(
        span,
        permissionContext,
        req.params.accountId,
      );
      const page = pagination.page;
      const pageSize = pagination.pageSize;
      const result = await FileDataListTrashPaginated(
        span,
        req.params.accountId,
        permittedFolderIds,
        page,
        pageSize,
      );
      MediaUrlsAttachForUser(result.files, userSession);
      return res.status(200).send({
        files: result.files,
        page,
        pageSize,
        total: result.total,
        retentionDays: this.config.TRASH_RETENTION_DAYS,
      });
    });

    interface PostFileIdListRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        fileIdList: string[];
      };
    }

    fastify.post<PostFileIdListRequest>("/restore", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }
      let restoredCount = 0;
      const restoredFileIds: string[] = [];
      for (const fileId of req.body.fileIdList) {
        const file = await FileDataGet(span, fileId);
        if (!file) {
          return res.status(404).send({ error: "File not found" });
        }
        if (file.accountId !== req.params.accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const rowsAffected = await FileDataRestore(
          span,
          fileId,
          req.params.accountId,
        );
        if (rowsAffected > 0) {
          restoredCount += rowsAffected;
          restoredFileIds.push(fileId);
        }
      }
      SyncQueueBroadcastOperationComplete("fileRestore", restoredFileIds);
      return res.status(200).send({ restored: restoredCount });
    });

    fastify.post<PostFileIdListRequest>("/purge", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }
      // Only currently-trashed files can be purged: the actual cloud delete
      // is done by the fileDelete queue operation on rows the folder sync
      // still reconciles.
      for (const fileId of req.body.fileIdList) {
        const file = await FileDataGet(span, fileId);
        if (!file) {
          return res.status(404).send({ error: "File not found" });
        }
        if (file.accountId !== req.params.accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
        if (!file.trashed) {
          return res
            .status(409)
            .send({ error: "File is not in the Trash" });
        }
      }
      const accountId = req.params.accountId;
      for (const fileId of req.body.fileIdList) {
        SyncQueueQueueItem(
          accountId,
          `fileDelete:${accountId}:${fileId}`,
          { fileId },
          "fileDelete",
          SyncQueueItemPriority.INTERACTIVE,
          [fileId],
        );
      }
      return res.status(202).send({});
    });
  }
}
