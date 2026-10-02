import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AuthGetUserSession } from "../users/Auth";
import {
  AnalysisDataGetFileDuplicates,
  AnalysisDataGetFilesDuplicateCounts,
  AnalysisDataListAccountDuplicates,
} from "./AnalysisData";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";

const DUPLICATE_COUNTS_MAX_IDS = 200;

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

export class AnalysisRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetAccountDuplicatesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
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
        const duplicates = await AnalysisDataListAccountDuplicates(
          span,
          req.params.accountId,
          await permittedFolderIdsGet(
            span,
            userSession.userId,
            req.params.accountId,
          ),
        );
        return res.send({ duplicates });
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
