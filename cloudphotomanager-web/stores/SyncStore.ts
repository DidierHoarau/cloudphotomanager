import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";

export const SyncStore = defineStore("SyncStore", {
  state: () => ({
    countTotal: 0,
    countBlocking: 0,
    counts: [] as { type: string; count: number }[],
    processingFileIds: [] as string[],
    pendingFileIds: [] as string[],
    queueItems: [] as any[],
    queueTotalItems: 0,
    queueTruncated: false,
    monitoring: false,
    wsConnected: false,
    // Fallback polling state
    checkFrequencyMin: 800,
    checkFrequency: 5000,
    checkFrequencyMax: 30000,
    checking: false,
    lastUpdate: new Date(),
    _ws: null as WebSocket | null,
    _reconnectTimeout: null as ReturnType<typeof setTimeout> | null,
    _reconnectDelay: 1000,
  }),

  getters: {
    isFileProcessing:
      (state) =>
      (fileId: string): boolean => {
        return (
          state.processingFileIds.includes(fileId) ||
          state.pendingFileIds.includes(fileId)
        );
      },
  },

  actions: {
    async monitor() {
      if (this.monitoring) {
        return;
      }
      this.monitoring = true;
      await this._connectWebSocket();
    },

    async _connectWebSocket() {
      const config = await Config.get();
      // Build an absolute WS URL, handling relative SERVER_URL (e.g. "/api")
      let serverUrl: string = config.SERVER_URL;
      if (serverUrl.startsWith("/")) {
        // Relative path: derive origin from window.location
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        serverUrl = `${proto}://${window.location.host}${serverUrl}`;
      } else {
        serverUrl = serverUrl
          .replace(/^https:\/\//, "wss://")
          .replace(/^http:\/\//, "ws://");
      }

      const authHeader = await AuthService.getAuthHeader();
      const token =
        authHeader?.headers?.Authorization?.replace("Bearer ", "") || "";

      const fullWsUrl = `${serverUrl}/sync/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(fullWsUrl);
      } catch {
        this._scheduleReconnect();
        return;
      }
      this._ws = ws;

      ws.onopen = () => {
        this.wsConnected = true;
        this._reconnectDelay = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "queue_update") {
            this.processingFileIds = msg.processingFileIds || [];
            this.counts = msg.counts || [];
            this.queueItems = msg.items || [];
            let total = 0;
            for (const c of this.counts) {
              total += c.count;
            }
            this.countTotal = total;
            this.queueTotalItems =
              typeof msg.totalItems === "number" ? msg.totalItems : total;
            this.queueTruncated = !!msg.truncated;
          } else if (msg.type === "folder_cache_updated") {
            EventBus.emit(EventTypes.FOLDER_CACHE_UPDATED);
          } else if (msg.type === "operation_complete") {
            const completedIds = msg.fileIds || [];
            if (completedIds.length > 0) {
              this.pendingFileIds = this.pendingFileIds.filter(
                (id) => !completedIds.includes(id),
              );
            }
            EventBus.emit(EventTypes.OPERATION_COMPLETE, {
              operationName: msg.operationName,
              fileIds: msg.fileIds || [],
              priority: msg.priority,
            });
            // Only show toast for interactive operations (priority 1)
            if (msg.priority === 1) {
              const opNames: Record<string, string> = {
                fileDelete: "Delete complete",
                folderMove: "Move complete",
                fileRename: "Rename complete",
              };
              const text = opNames[msg.operationName] || "Operation complete";
              EventBus.emit(EventTypes.ALERT_MESSAGE, { type: "info", text });
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        this.wsConnected = false;
      };

      ws.onclose = () => {
        this.wsConnected = false;
        this._ws = null;
        this._scheduleReconnect();
      };
    },

    _scheduleReconnect() {
      if (this._reconnectTimeout) {
        clearTimeout(this._reconnectTimeout);
      }
      this._reconnectTimeout = setTimeout(() => {
        this._reconnectTimeout = null;
        this._connectWebSocket();
      }, this._reconnectDelay);
      // Exponential backoff capped at 30s
      this._reconnectDelay = Math.min(30000, this._reconnectDelay * 2);
    },

    markOperationInProgress() {
      this.countTotal++;
    },

    markFilesAsPending(fileIds: string[]) {
      for (const id of fileIds) {
        if (!this.pendingFileIds.includes(id)) {
          this.pendingFileIds.push(id);
        }
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(SyncStore, import.meta.hot));
}
