import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Span } from "@opentelemetry/sdk-trace";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import {
  AnalysisDataGetDuplicateGroupSummaries,
  AnalysisDataGetFileDuplicates,
  AnalysisDataGetFilesDuplicateCounts,
  AnalysisDataListAccountDuplicates,
} from "./AnalysisData";
import {
  DuplicateIgnoreDataAddMany,
  DuplicateIgnoreDataList,
  DuplicateIgnoreDataPruneStale,
  DuplicateIgnoreDataRemove,
} from "./DuplicateIgnoreData";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { PaginationParse } from "../utils-std-ts/Pagination";

const DUPLICATE_COUNTS_MAX_IDS = 200;
const DUPLICATE_HASHES_MAX = 200;
const DUPLICATE_HASH_MAX_LENGTH = 500;

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

// Validates a list of content hashes for the ignore/unignore routes: one to
// DUPLICATE_HASHES_MAX deduplicated non-empty strings.
function hashesParse(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const unique = new Set<string>();
  for (const value of raw) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > DUPLICATE_HASH_MAX_LENGTH
    ) {
      return null;
    }
    unique.add(value);
  }
  if (unique.size === 0 || unique.size > DUPLICATE_HASHES_MAX) {
    return null;
  }
  return [...unique];
}

export class AnalysisRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetAccountDuplicatesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Querystring: {
        page?: string;
        pageSize?: string;
      };
    }
    fastify.get<GetAccountDuplicatesRequest>(
      "/duplicates",
      async (req, res) => {
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
        const result = await AnalysisDataListAccountDuplicates(
          span,
          req.params.accountId,
          await permittedFolderIdsGet(
            span,
            userSession.userId,
            req.params.accountId,
          ),
          pagination.page,
          pagination.pageSize,
        );
        for (const duplicate of result.duplicates) {
          MediaUrlsAttachForUser(duplicate.files, userSession);
        }
        return res.send({
          duplicates: result.duplicates,
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: result.total,
        });
      },
    );

    // Static route: registered before /duplicates/:fileId so an ignore list
    // request can never be matched as a file id.
    interface GetAccountDuplicatesIgnoredRequest
      extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetAccountDuplicatesIgnoredRequest>(
      "/duplicates/ignored",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!AuthIsAdmin(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        await DuplicateIgnoreDataPruneStale(span, req.params.accountId);
        const ignores = await DuplicateIgnoreDataList(
          span,
          req.params.accountId,
        );
        return res.send({ ignores });
      },
    );

    interface PostDuplicatesIgnoreRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        hashes?: string[];
      };
    }
    fastify.post<PostDuplicatesIgnoreRequest>(
      "/duplicates/ignore",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!AuthIsAdmin(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const hashes = hashesParse(req.body?.hashes);
        if (!hashes) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: hashes" });
        }
        // Snapshot only the hashes that currently form a group for this
        // account: the client-supplied filenames and counts are never trusted.
        const summaries = await AnalysisDataGetDuplicateGroupSummaries(
          span,
          req.params.accountId,
          hashes,
        );
        const entries = Object.entries(summaries).map(([hash, summary]) => ({
          hash,
          ...summary,
        }));
        const ignored = await DuplicateIgnoreDataAddMany(
          span,
          req.params.accountId,
          entries,
          userSession.userId,
        );
        return res.send({ ignored });
      },
    );

    fastify.post<PostDuplicatesIgnoreRequest>(
      "/duplicates/unignore",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!AuthIsAdmin(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const hashes = hashesParse(req.body?.hashes);
        if (!hashes) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: hashes" });
        }
        const unignored = await DuplicateIgnoreDataRemove(
          span,
          req.params.accountId,
          hashes,
        );
        return res.send({ unignored });
      },
    );

    interface GetFileDuplicatesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.get<GetFileDuplicatesRequest>(
      "/duplicates/:fileId",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const duplicate = await AnalysisDataGetFileDuplicates(
          span,
          req.params.accountId,
          req.params.fileId,
          await permittedFolderIdsGet(
            span,
            userSession.userId,
            req.params.accountId,
          ),
        );
        if (duplicate?.files) {
          MediaUrlsAttachForUser(duplicate.files, userSession);
        }
        return res.send({ duplicate });
      },
    );

    interface PostDuplicateCountsRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        fileIds?: string[];
      };
    }
    fastify.post<PostDuplicateCountsRequest>(
      "/duplicates/counts",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const fileIds = Array.isArray(req.body?.fileIds)
          ? req.body.fileIds.filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            )
          : [];
        if (fileIds.length === 0) {
          return res.send({ counts: {} });
        }
        if (fileIds.length > DUPLICATE_COUNTS_MAX_IDS) {
          return res.status(400).send({
            error: `Too many fileIds (max ${DUPLICATE_COUNTS_MAX_IDS})`,
          });
        }
        const counts = await AnalysisDataGetFilesDuplicateCounts(
          span,
          req.params.accountId,
          fileIds,
          await permittedFolderIdsGet(
            span,
            userSession.userId,
            req.params.accountId,
          ),
        );
        return res.send({ counts });
      },
    );
  }
}
