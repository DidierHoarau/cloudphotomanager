import { FastifyInstance } from "fastify";
import { WebSocket } from "@fastify/websocket";
import { AuthGetUserSession, AuthIsTokenValid } from "../users/Auth";
import { SyncEventHistoryGetRecent } from "./SyncEventHistory";
import {
  SyncQueueGetCounts,
  SyncQueueGetProcessingFileIds,
  SyncQueueGetQueue,
  SyncQueueRegisterBroadcast,
} from "./SyncQueue";
import { FolderDataRegisterOnCacheRefreshed } from "../folders/FolderData";

const wsClients = new Set<WebSocket>();

function broadcastToClients(message: object): void {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    try {
      if (client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    } catch {
      wsClients.delete(client);
    }
  }
}

export class SyncRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // Register the broadcast function for queue events
    SyncQueueRegisterBroadcast(broadcastToClients);
    // Notify clients when folder cache is refreshed
    FolderDataRegisterOnCacheRefreshed(() =>
      broadcastToClients({ type: "folder_cache_updated" }),
    );

    //
    fastify.get("/status", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(200).send({
        sync: SyncQueueGetCounts(),
        recentEvents: await SyncEventHistoryGetRecent(),
      });
    });

    fastify.get("/queue", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const counts = SyncQueueGetCounts();
      const items = SyncQueueGetQueue();
      const totalItems = counts.reduce((sum, c) => sum + (c.count || 0), 0);
      return res.status(200).send({
        counts,
        items,
        totalItems,
        truncated: items.length < totalItems,
      });
    });

    fastify.get("/ws", { websocket: true }, (socket, req) => {
      // Validate token from query string
      const token = (req.query as Record<string, string>).token || "";
      if (!AuthIsTokenValid(token)) {
        socket.close(1008, "Unauthorized");
        return;
      }

      wsClients.add(socket);

      // Send current state immediately on connect
      try {
        socket.send(
          JSON.stringify({
            type: "queue_update",
            counts: SyncQueueGetCounts(),
            processingFileIds: SyncQueueGetProcessingFileIds(),
            items: SyncQueueGetQueue(),
          }),
        );
      } catch {
        // ignore send errors on connect
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
