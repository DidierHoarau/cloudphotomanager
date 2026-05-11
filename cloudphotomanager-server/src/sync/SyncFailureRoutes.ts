import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { OTelLogger } from "../OTelContext";
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
      const all = SyncFailuresList();
      for (const failure of all) {
        if (failure.kind === "conflict") continue;
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
        return res
          .status(400)
          .send({
            error: "Invalid action (expected 'replace' | 'deleteSource')",
          });
      }
      const accountId = failure.accountId;
      const conflict = failure.conflict;
      if (action === "replace") {
        if (!conflict.targetFileId) {
          return res
            .status(400)
            .send({ error: "Target file id not available, cannot replace" });
        }
        // Queue target deletion first
        SyncQueueQueueItem(
          accountId,
          `fileDelete:${accountId}:${conflict.targetFileId}`,
          { fileId: conflict.targetFileId },
          "fileDelete",
          SyncQueueItemPriority.INTERACTIVE,
          [conflict.targetFileId],
        );
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
        SyncQueueQueueItem(
          accountId,
          `fileDelete:${accountId}:${conflict.sourceFileId}`,
          { fileId: conflict.sourceFileId },
          "fileDelete",
          SyncQueueItemPriority.INTERACTIVE,
          [conflict.sourceFileId],
        );
      }
      SyncFailuresRemove(failure.id);
      return res.status(200).send({});
    });
  }
}

function requeueFailure(failure: SyncFailure): void {
  try {
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
