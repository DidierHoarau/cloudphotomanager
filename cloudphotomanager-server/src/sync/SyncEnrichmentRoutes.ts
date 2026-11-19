import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { Span } from "@opentelemetry/sdk-trace";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { OTelLogger } from "../OTelContext";
import {
  FileDataGet,
  FileDataGetEnrichmentHealth,
  FileDataResetEnrichment,
} from "../files/FileData";
import { AccountDataList } from "../accounts/AccountData";
import { FolderDataGet } from "../folders/FolderData";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueQueueFileItemsBulk } from "./SyncQueue";
import {
  EnrichmentRuntimeGetState,
  EnrichmentRuntimeIsEnabled,
  EnrichmentRuntimeReset,
} from "./EnrichmentRuntime";

const logger = OTelLogger().createModuleLogger("SyncEnrichmentRoutes");

function isAdminSession(userSession: any): boolean {
  return userSession?.isAuthenticated === true && AuthIsAdmin(userSession);
}

interface RetryRequest extends RequestGenericInterface {
  Body: { accountId?: string; folderId?: string };
}

interface FileRetryRequest extends RequestGenericInterface {
  Params: { fileId: string };
}

export class SyncEnrichmentRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // Library-health surface: enrichment/model state plus the media retry-cap
    // breakdown, restricted to admin operators.
    fastify.get("/health", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!isAdminSession(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const health = await FileDataGetEnrichmentHealth(span);
      const accounts = await AccountDataList(span);
      const names = new Map(
        accounts.map((account) => [account.id, account.name]),
      );
      return res.status(200).send({
        generatedAt: new Date().toISOString(),
        enrichment: EnrichmentRuntimeGetState(),
        totals: health.totals,
        accounts: health.accounts.map((account) => ({
          ...account,
          name: names.get(account.accountId) || account.accountId,
        })),
        lastEnrichmentError: health.lastEnrichmentError,
        retryCap: health.retryCap,
        oldestWaitingItem: health.oldestWaitingItem,
      });
    });

    // Repair action: reset enrichment-only failures and re-queue them. The
    // scope can be the whole library, one account, or one folder subtree.
    fastify.post<RetryRequest>("/enrichment/retry", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!isAdminSession(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!EnrichmentRuntimeIsEnabled()) {
        return res.status(409).send({
          error:
            "Image classification is disabled (IMAGE_CLASSIFICATION_ENABLED=N)",
        });
      }
      const accountId = req.body?.accountId || undefined;
      const folderId = req.body?.folderId || undefined;
      let folderpath: string | undefined;
      let effectiveAccountId = accountId;
      if (folderId) {
        const folder = await FolderDataGet(span, folderId);
        if (!folder) {
          return res.status(404).send({ error: "Folder not found" });
        }
        if (accountId && folder.accountId !== accountId) {
          return res
            .status(400)
            .send({ error: "Folder does not belong to the account" });
        }
        effectiveAccountId = folder.accountId;
        folderpath = folder.folderpath;
      }
      return res.status(200).send(
        await retryEnrichment(span, {
          accountId: effectiveAccountId,
          folderId,
          folderpath,
        }),
      );
    });

    fastify.post<FileRetryRequest>(
      "/enrichment/retry/:fileId",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!isAdminSession(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        if (!EnrichmentRuntimeIsEnabled()) {
          return res.status(409).send({
            error:
              "Image classification is disabled (IMAGE_CLASSIFICATION_ENABLED=N)",
          });
        }
        const file = await FileDataGet(span, req.params.fileId);
        if (!file) {
          return res.status(404).send({ error: "File not found" });
        }
        return res.status(200).send(
          await retryEnrichment(span, {
            accountId: file.accountId,
            fileId: file.id,
          }),
        );
      },
    );
  }
}

async function retryEnrichment(
  span: Span,
  scope: {
    accountId?: string;
    folderId?: string;
    folderpath?: string;
    fileId?: string;
  },
): Promise<{ matched: number; queued: number }> {
  const candidates = await FileDataResetEnrichment(span, scope);
  // A manual repair is the operator's confirmation that model access is
  // restored: clear the circuit so the queued files are processed now.
  EnrichmentRuntimeReset();
  const queued = SyncQueueQueueFileItemsBulk(
    "syncPhotoKeyWords",
    candidates,
    SyncQueueItemPriority.BATCH,
  );
  logger.info(
    `Enrichment retry queued ${queued} of ${candidates.length} matching files` +
      (scope.accountId ? ` for account ${scope.accountId}` : "") +
      (scope.folderId ? ` in folder ${scope.folderId}` : "") +
      (scope.fileId ? ` for file ${scope.fileId}` : ""),
  );
  return { matched: candidates.length, queued };
}
