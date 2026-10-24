import { FastifyInstance } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import {
  FileDataListAccountMonths,
  FileDataListByMonthPaginated,
} from "../files/FileData";
import { File } from "../model/File";
import { AuthGetUserSession } from "../users/Auth";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { PaginationParse } from "../utils-std-ts/Pagination";

export class TimelineRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/months", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
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
      const months = await FileDataListAccountMonths(
        span,
        req.params.accountId,
        permittedFolderIds,
      );
      return res.status(200).send({ months });
    });

    fastify.get<{
      Params: {
        accountId: string;
      };
      Querystring: {
        year?: string;
        month?: string;
        sortOrder?: string;
        page?: string;
        pageSize?: string;
      };
    }>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const year = parseInt(req.query.year || "", 10);
      const month = parseInt(req.query.month || "", 10);
      if (!year || !month || month < 1 || month > 12) {
        return res
          .status(400)
          .send({ error: "Missing or invalid parameters: year, month" });
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
      // UTC month bounds: dateMedia is stored as an ISO string, so string
      // comparison against the ISO month range is timezone-safe.
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const monthEndExclusive = new Date(Date.UTC(year, month, 1));
      const sortOrder: "asc" | "desc" =
        req.query.sortOrder === "asc" ? "asc" : "desc";
      const page = pagination.page;
      const pageSize = pagination.pageSize;
      const result: { files: File[]; total: number } =
        await FileDataListByMonthPaginated(
          span,
          req.params.accountId,
          permittedFolderIds,
          monthStart.toISOString(),
          monthEndExclusive.toISOString(),
          sortOrder,
          page,
          pageSize,
        );
      MediaUrlsAttachForUser(result.files, userSession);
      return res.status(200).send({
        files: result.files,
        page,
        pageSize,
        total: result.total,
      });
    });
  }
}
