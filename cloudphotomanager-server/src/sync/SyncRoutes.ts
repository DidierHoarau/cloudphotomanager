import { FastifyInstance } from "fastify";
import { Span } from "@opentelemetry/sdk-trace-base";
import { WebSocket } from "@fastify/websocket";
import { AuthGetUserSession, AuthValidateWsRequest } from "../users/Auth";
import { SyncEventHistoryGetRecent } from "./SyncEventHistory";
import {
  SyncQueueGetCounts,
  SyncQueueGetProcessingFileIds,
  SyncQueueGetQueue,
  SyncQueueRegisterBroadcast,
} from "./SyncQueue";
import {
  SyncFailuresGetCount,
  SyncFailuresList,
  SyncFailuresRegisterBroadcast,
} from "./SyncFailures";
import { FolderDataGet, FolderDataRegisterOnCacheRefreshed } from "../folders/FolderData";
import { FileDataGet } from "../files/FileData";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { OTelTracer } from "../OTelContext";
import {
  UserPermissionContext,
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
  UserPermissionFolderRef,
} from "../users/UserPermissionCheck";

const wsClients = new Map<WebSocket, { userId: string }>();

interface ViewerPermissionCache {
  permissionContext: UserPermissionContext;
  folderRefs: Map<string, UserPermissionFolderRef | null>;
  fileFolderIds: Map<string, string | null>;
}

async function viewerCacheGet(
  span: Span,
  userId: string,
): Promise<ViewerPermissionCache> {
  return {
    permissionContext: await UserPermissionContextGet(span, userId),
    folderRefs: new Map(),
    fileFolderIds: new Map(),
  };
}

async function folderRefGet(
  span: Span,
  cache: ViewerPermissionCache,
  folderId: string,
): Promise<UserPermissionFolderRef | null> {
  if (cache.folderRefs.has(folderId)) {
    return cache.folderRefs.get(folderId);
  }
  const folder = await FolderDataGet(span, folderId);
  const ref = folder
    ? { id: folder.id, accountId: folder.accountId, folderpath: folder.folderpath }
    : null;
  cache.folderRefs.set(folderId, ref);
  return ref;
}

async function fileFolderIdGet(
  span: Span,
  cache: ViewerPermissionCache,
  fileId: string,
): Promise<string | null> {
  if (cache.fileFolderIds.has(fileId)) {
    return cache.fileFolderIds.get(fileId);
  }
  const file = await FileDataGet(span, fileId);
  const folderId = file ? file.folderId : null;
  cache.fileFolderIds.set(fileId, folderId);
  return folderId;
}

interface SyncViewableItem {
  accountId: string;
  folderId?: string | null;
  fileIds?: string[];
}

async function itemIsVisible(
  span: Span,
  cache: ViewerPermissionCache,
  item: SyncViewableItem,
): Promise<boolean> {
  if (cache.permissionContext.isAdmin) {
    return true;
  }
  const folderIds = new Set<string>();
  if (item.folderId) {
    folderIds.add(item.folderId);
  }
  for (const fileId of item.fileIds || []) {
    const folderId = await fileFolderIdGet(span, cache, fileId);
    if (folderId) {
      folderIds.add(folderId);
    }
  }
  if (folderIds.size === 0) {
    // Undetermined scope (legacy payload): fall back to account membership.
    return cache.permissionContext.grants.some(
      (grant) => grant.accountId === item.accountId,
    );
  }
  for (const folderId of Array.from(folderIds)) {
    const ref = await folderRefGet(span, cache, folderId);
    if (
      ref &&
      UserPermissionContextFolderIsPermitted(cache.permissionContext, ref)
    ) {
      return true;
    }
  }
  return false;
}

async function visibleFileIdsGet(
  span: Span,
  cache: ViewerPermissionCache,
  fileIds: string[],
): Promise<string[]> {
  if (cache.permissionContext.isAdmin) {
    return fileIds;
  }
  const visible: string[] = [];
  for (const fileId of fileIds || []) {
    const folderId = await fileFolderIdGet(span, cache, fileId);
    if (!folderId) {
      continue;
    }
    const ref = await folderRefGet(span, cache, folderId);
    if (
      ref &&
      UserPermissionContextFolderIsPermitted(cache.permissionContext, ref)
    ) {
      visible.push(fileId);
    }
  }
  return visible;
}

async function queueMessageForViewer(
  span: Span,
  cache: ViewerPermissionCache,
  message: any,
): Promise<any | null> {
  if (cache.permissionContext.isAdmin) {
    return message;
  }
  const items: any[] = [];
  for (const item of message.items || []) {
    if (await itemIsVisible(span, cache, item)) {
      items.push(item);
    }
  }
  const counts = [
    {
      type: "ACTIVE",
      count: items.filter((item) => item.status === "ACTIVE").length,
    },
    {
      type: "WAITING",
      count: items.filter((item) => item.status === "WAITING").length,
    },
  ];
  return {
    type: "queue_update",
    counts,
    processingFileIds: await visibleFileIdsGet(
      span,
      cache,
      message.processingFileIds || [],
    ),
    items,
    totalItems: counts.reduce((sum, c) => sum + c.count, 0),
    truncated: message.truncated === true,
    failuresCount: await visibleFailuresCountGet(span, cache),
  };
}

async function visibleFailuresGet(
  span: Span,
  cache: ViewerPermissionCache,
): Promise<any[]> {
  const visible: any[] = [];
  for (const failure of SyncFailuresList()) {
    if (
      await itemIsVisible(span, cache, {
        accountId: failure.accountId,
        folderId: failure.data?.folderId || null,
        fileIds: failure.fileIds || [],
      })
    ) {
      visible.push(failure);
    }
  }
  return visible;
}

async function visibleFailuresCountGet(
  span: Span,
  cache: ViewerPermissionCache,
): Promise<number> {
  return (await visibleFailuresGet(span, cache)).length;
}

async function failuresMessageForViewer(
  span: Span,
  cache: ViewerPermissionCache,
  message: any,
): Promise<any | null> {
  if (cache.permissionContext.isAdmin) {
    return message;
  }
  const items = await visibleFailuresGet(span, cache);
  return { type: "failures_update", count: items.length, items };
}

async function operationCompleteMessageForViewer(
  span: Span,
  cache: ViewerPermissionCache,
  message: any,
): Promise<any | null> {
  if (cache.permissionContext.isAdmin) {
    return message;
  }
  const fileIds = await visibleFileIdsGet(span, cache, message.fileIds || []);
  if (fileIds.length === 0) {
    return null;
  }
  return { ...message, fileIds };
}

async function messageForViewer(
  span: Span,
  cache: ViewerPermissionCache,
  message: any,
): Promise<any | null> {
  if (!message || typeof message !== "object") {
    return message;
  }
  if (message.type === "queue_update") {
    return queueMessageForViewer(span, cache, message);
  }
  if (message.type === "failures_update") {
    return failuresMessageForViewer(span, cache, message);
  }
  if (message.type === "operation_complete") {
    return operationCompleteMessageForViewer(span, cache, message);
  }
  return message;
}

function broadcastToClients(message: object): void {
  const span = OTelTracer().startSpan("SyncRoutesBroadcast");
  const sends: Promise<void>[] = [];
  for (const [client, entry] of wsClients) {
    sends.push(
      broadcastToClient(span, client, entry.userId, message).catch(() => {
        /* per-client send errors are non-fatal */
      }),
    );
  }
  Promise.allSettled(sends).finally(() => span.end());
}

async function broadcastToClient(
  span: Span,
  client: WebSocket,
  userId: string,
  message: any,
): Promise<void> {
  if (client.readyState !== 1 /* OPEN */) {
    return;
  }
  const cache = await viewerCacheGet(span, userId);
  const filtered = await messageForViewer(span, cache, message);
  if (filtered === null) {
    return;
  }
  try {
    client.send(JSON.stringify(filtered));
  } catch {
    wsClients.delete(client);
  }
}

export class SyncRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // Register the broadcast function for queue events
    SyncQueueRegisterBroadcast(broadcastToClients);
    SyncFailuresRegisterBroadcast(broadcastToClients);
    // Notify clients when folder cache is refreshed
    FolderDataRegisterOnCacheRefreshed(() =>
      broadcastToClients({ type: "folder_cache_updated" }),
    );

    //
    fastify.get("/status", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const cache = await viewerCacheGet(span, userSession.userId);
      if (cache.permissionContext.isAdmin) {
        return res.status(200).send({
          sync: SyncQueueGetCounts(),
          recentEvents: await SyncEventHistoryGetRecent(),
          failuresCount: SyncFailuresGetCount(),
        });
      }
      const queueMessage = await queueMessageForViewer(span, cache, {
        items: SyncQueueGetQueue(),
        processingFileIds: [],
        truncated: false,
      });
      const recentEvents = (await SyncEventHistoryGetRecent()).filter((event) =>
        cache.permissionContext.grants.some(
          (grant) => grant.accountId === event.accountId,
        ),
      );
      return res.status(200).send({
        sync: queueMessage.counts,
        recentEvents,
        failuresCount: queueMessage.failuresCount,
      });
    });

    fastify.get("/queue", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const cache = await viewerCacheGet(span, userSession.userId);
      const allItems = SyncQueueGetQueue();
      const counts = SyncQueueGetCounts();
      if (cache.permissionContext.isAdmin) {
        const totalItems = counts.reduce((sum, c) => sum + (c.count || 0), 0);
        return res.status(200).send({
          counts,
          items: allItems,
          totalItems,
          truncated: allItems.length < totalItems,
        });
      }
      const items: any[] = [];
      for (const item of allItems) {
        if (await itemIsVisible(span, cache, item)) {
          items.push(item);
        }
      }
      const visibleCounts = [
        {
          type: "ACTIVE",
          count: items.filter((item) => item.status === "ACTIVE").length,
        },
        {
          type: "WAITING",
          count: items.filter((item) => item.status === "WAITING").length,
        },
      ];
      const totalItems = visibleCounts.reduce((sum, c) => sum + c.count, 0);
      return res.status(200).send({
        counts: visibleCounts,
        items,
        totalItems,
        truncated: items.length < totalItems,
      });
    });

    fastify.get("/ws", { websocket: true }, async (socket, req) => {
      // Authenticate the upgrade with the same credentials as the REST API
      // (signed session cookie for the web app, Authorization header for API
      // clients). Tokens in the query string are no longer accepted.
      const userSession = await AuthValidateWsRequest(req);
      if (!userSession.isAuthenticated) {
        socket.close(1008, "Unauthorized");
        return;
      }
      const span = OTelTracer().startSpan("SyncRoutesWsConnect");
      try {
        wsClients.set(socket, { userId: userSession.userId });

        // Send current state immediately on connect, filtered for this user.
        const cache = await viewerCacheGet(span, userSession.userId);
        const queueMessage = await messageForViewer(span, cache, {
          type: "queue_update",
          counts: SyncQueueGetCounts(),
          processingFileIds: SyncQueueGetProcessingFileIds(),
          items: SyncQueueGetQueue(),
          failuresCount: SyncFailuresGetCount(),
        });
        socket.send(JSON.stringify(queueMessage));
        socket.send(
          JSON.stringify(
            await messageForViewer(span, cache, {
              type: "failures_update",
              count: SyncFailuresGetCount(),
              items: SyncFailuresList(),
            }),
          ),
        );
      } catch {
        // ignore send errors on connect
      } finally {
        span.end();
      }

      socket.on("close", () => {
        wsClients.delete(socket);
      });

      socket.on("error", () => {
        wsClients.delete(socket);
      });
    });
  }
}
