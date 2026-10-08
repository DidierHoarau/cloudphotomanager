import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { FileDataRecordSyncSuccess } from "../files/FileData";
import {
  SyncFailure,
  SyncFailuresClearAll,
  SyncFailuresGet,
  SyncFailuresGetCount,
  SyncFailuresList,
  SyncFailuresRemove,
} from "./SyncFailures";
import { SyncQueueQueueItem } from "./SyncQueue";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

const logger = OTelLogger().createModuleLogger("SyncFailureRoutes");

export class SyncFailureRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(200).send({
        items: SyncFailuresList(),
        count: SyncFailuresGetCount(),
      });
    });

    interface IdRequest extends RequestGenericInterface {
      Params: { id: string };
    }

    fastify.post<IdRequest>("/:id/cancel", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const removed = SyncFailuresRemove(req.params.id);
      if (!removed) {
        return res.status(404).send({ error: "Failure not found" });
      }
      return res.status(200).send({});
    });

    fastify.post("/cancel-all", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const cleared = SyncFailuresClearAll();
      return res.status(200).send({ cleared });
    });

    fastify.post<IdRequest>("/:id/retry", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const failure = SyncFailuresGet(req.params.id);
      if (!failure) {
        return res.status(404).send({ error: "Failure not found" });
      }
      requeueFailure(failure);
      SyncFailuresRemove(failure.id);
      return res.status(200).send({});
    });

    fastify.post("/retry-all", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      let retried = 0;
      // Retry every failure, conflict or plain error. Conflicts that still
      // exist will simply be re-detected and recorded again by the dispatcher.
      const all = SyncFailuresList();
      for (const failure of all) {
        requeueFailure(failure);
        SyncFailuresRemove(failure.id);
        retried++;
      }
      return res.status(200).send({ retried });
    });

    interface ResolveRequest extends RequestGenericInterface {
      Params: { id: string };
      Body: { action: "replace" | "deleteSource" };
    }

    fastify.post<ResolveRequest>("/:id/resolve", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const failure = SyncFailuresGet(req.params.id);
      if (!failure) {
        return res.status(404).send({ error: "Failure not found" });
      }
      if (failure.kind !== "conflict" || !failure.conflict) {
        return res
          .status(400)
          .send({ error: "Failure is not a conflict, use /retry instead" });
      }
      const action = req.body?.action;
      if (action !== "replace" && action !== "deleteSource") {
        return res.status(400).send({
          error: "Invalid action (expected 'replace' | 'deleteSource')",
        });
      }
      if (
        resolveConflictFailure(failure, action, new Set()) === "missingTarget"
      ) {
        return res
          .status(400)
          .send({ error: "Target file id not available, cannot replace" });
      }
      return res.status(200).send({});
    });

    interface ResolveAllRequest extends RequestGenericInterface {
      Body: { action: "replace" | "deleteSource" };
    }

    fastify.post<ResolveAllRequest>("/resolve-all", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const action = req.body?.action;
      if (action !== "replace" && action !== "deleteSource") {
        return res.status(400).send({
          error: "Invalid action (expected 'replace' | 'deleteSource')",
        });
      }
      let resolved = 0;
      // Apply the action only to the failures it applies to (see
      // resolveConflictFailure); everything else is left untouched. Each
      // file is deleted once even when several conflicts reference it.
      const queuedFileDeletes = new Set<string>();
      for (const failure of SyncFailuresList()) {
        if (
          resolveConflictFailure(failure, action, queuedFileDeletes) ===
          "resolved"
        ) {
          resolved++;
        }
      }
      return res.status(200).send({ resolved });
    });
  }
}

type ResolveResult = "resolved" | "notConflict" | "missingTarget";

// Queue the operations resolving a conflict failure with the given action,
// then remove the failure. Returns "notConflict" / "missingTarget" (touching
// nothing) when the failure does not apply to the action. queuedFileDeletes
// dedupes file deletions across the failures resolved by one request.
function resolveConflictFailure(
  failure: SyncFailure,
  action: "replace" | "deleteSource",
  queuedFileDeletes: Set<string>,
): ResolveResult {
  if (failure.kind !== "conflict" || !failure.conflict) {
    return "notConflict";
  }
  const accountId = failure.accountId;
  const conflict = failure.conflict;
  if (action === "replace") {
    if (!conflict.targetFileId) {
      return "missingTarget";
    }
    // Queue target deletion first
    queueFileDeleteOnce(accountId, conflict.targetFileId, queuedFileDeletes);
    // Then re-queue the move
    SyncQueueQueueItem(
      accountId,
      `folderMove:${accountId}:${conflict.sourceFileId}:${conflict.targetFolderpath}`,
      {
        fileId: conflict.sourceFileId,
        folderpath: conflict.targetFolderpath,
      },
      "folderMove",
      SyncQueueItemPriority.INTERACTIVE,
      [conflict.sourceFileId],
    );
  } else {
    // deleteSource
    queueFileDeleteOnce(accountId, conflict.sourceFileId, queuedFileDeletes);
  }
  SyncFailuresRemove(failure.id);
  return "resolved";
}

function queueFileDeleteOnce(
  accountId: string,
  fileId: string,
  queuedFileDeletes: Set<string>,
): void {
  const key = `${accountId}:${fileId}`;
  if (queuedFileDeletes.has(key)) {
    return;
  }
  queuedFileDeletes.add(key);
  SyncQueueQueueItem(
    accountId,
    `fileDelete:${accountId}:${fileId}`,
    { fileId },
    "fileDelete",
    SyncQueueItemPriority.INTERACTIVE,
    [fileId],
  );
}

function requeueFailure(failure: SyncFailure): void {
  try {
    // A manual retry grants the files a fresh set of automatic attempts,
    // so reset the poison-file retry counter.
    const span = OTelTracer().startSpan("SyncFailureRoutesRetryResetFailCount");
    for (const fileId of failure.fileIds || []) {
      FileDataRecordSyncSuccess(span, fileId).catch((err) => {
        logger.error("Error resetting sync failure count", err);
      });
    }
    span.end();
    SyncQueueQueueItem(
      failure.accountId,
      `${failure.functionName}:retry:${failure.id}`,
      failure.data,
      failure.functionName,
      SyncQueueItemPriority.INTERACTIVE,
      failure.fileIds || [],
    );
  } catch (err) {
    logger.error("Error re-queuing failure", err);
  }
}
