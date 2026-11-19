import { FastifyInstance } from "fastify";
import { Span } from "@opentelemetry/sdk-trace";
import {
  SearchDataAggregateByGeoGrid,
  SearchDataCountFiles,
  SearchDataListAccountDuplicates,
  SearchDataListAccountLabels,
  SearchDataListAccountPlaces,
  SearchDataListFiles,
  SearchLimitClamp,
  SearchOffsetClamp,
  SearchSortNormalize,
} from "./SearchData";
import { AuthGetUserSession } from "../users/Auth";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { GeoBox, isValidGeoBox } from "./SearchGeoSql";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";

async function permittedFolderIdsGet(
  span: Span,
  userId: string,
  accountId: string,
): Promise<string[] | null> {
  const permissionContext = await UserPermissionContextGet(span, userId);
  return UserPermissionContextFolderIdsGet(
    span,
    permissionContext,
    accountId,
  );
}

function isValidDateFilter(value: any): boolean {
  return value === undefined || value === null || value === ""
    ? true
    : !Number.isNaN(new Date(value).getTime());
}

export class SearchRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //

    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/duplicates", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const duplicates = await SearchDataListAccountDuplicates(
        OTelRequestSpan(req),
        req.params.accountId,
        await permittedFolderIdsGet(
          OTelRequestSpan(req),
          userSession.userId,
          req.params.accountId,
        ),
      );
      for (const duplicate of duplicates) {
        MediaUrlsAttachForUser(duplicate.files, userSession);
      }
      return res.send({ duplicates });
    });

    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/labels", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const labels = await SearchDataListAccountLabels(
        OTelRequestSpan(req),
        req.params.accountId,
        await permittedFolderIdsGet(
          OTelRequestSpan(req),
          userSession.userId,
          req.params.accountId,
        ),
      );
      return res.send({ labels });
    });

    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/places", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const places = await SearchDataListAccountPlaces(
        OTelRequestSpan(req),
        req.params.accountId,
        await permittedFolderIdsGet(
          OTelRequestSpan(req),
          userSession.userId,
          req.params.accountId,
        ),
      );
      return res.send({ places });
    });

    fastify.post<{
      Params: {
        accountId: string;
      };
      Body: {
        filters: any;
        sort?: string;
        limit?: number;
        offset?: number;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const filters = req.body?.filters || {};
      if (
        filters.geoBox !== undefined &&
        filters.geoBox !== null &&
        !isValidGeoBox(filters.geoBox)
      ) {
        return res.status(400).send({ error: "Invalid geoBox" });
      }
      if (
        !isValidDateFilter(filters.dateFrom) ||
        !isValidDateFilter(filters.dateTo)
      ) {
        return res.status(400).send({ error: "Invalid date" });
      }
      const sort = SearchSortNormalize(req.body?.sort);
      const limit = SearchLimitClamp(req.body?.limit);
      const offset = SearchOffsetClamp(req.body?.offset);
      const permittedFolderIds = await permittedFolderIdsGet(
        OTelRequestSpan(req),
        userSession.userId,
        req.params.accountId,
      );
      const [files, total] = await Promise.all([
        SearchDataListFiles(
          OTelRequestSpan(req),
          req.params.accountId,
          filters,
          permittedFolderIds,
          { sort, limit, offset },
        ),
        SearchDataCountFiles(
          OTelRequestSpan(req),
          req.params.accountId,
          filters,
          permittedFolderIds,
        ),
      ]);
      MediaUrlsAttachForUser(files, userSession);
      return res.status(200).send({
        files,
        total,
        limit,
        offset,
        hasMore: offset + files.length < total,
      });
    });

    fastify.post<{
      Params: {
        accountId: string;
      };
      Body: {
        bbox: GeoBox;
        gridRows?: number;
        gridCols?: number;
        filters?: any;
      };
    }>("/geoGrid", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!isValidGeoBox(req.body?.bbox)) {
        return res.status(400).send({ error: "Invalid bbox" });
      }
      const result = await SearchDataAggregateByGeoGrid(
        OTelRequestSpan(req),
        req.params.accountId,
        {
          bbox: req.body.bbox,
          gridRows: req.body.gridRows,
          gridCols: req.body.gridCols,
          filters: req.body.filters,
        },
        await permittedFolderIdsGet(
          OTelRequestSpan(req),
          userSession.userId,
          req.params.accountId,
        ),
      );
      return res.status(200).send(result);
    });
  }
}
