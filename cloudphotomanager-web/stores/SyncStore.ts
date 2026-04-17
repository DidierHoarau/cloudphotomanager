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
        return state.processingFileIds.includes(fileId);
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
      // Convert http(s) to ws(s)
      const wsUrl = config.SERVER_URL.replace(/^https:\/\//, "wss://").replace(
        /^http:\/\//,
        "ws://",
      );

      const authHeader = await AuthService.getAuthHeader();
      const token =
        authHeader?.headers?.Authorization?.replace("Bearer ", "") || "";

      const fullWsUrl = `${wsUrl}/sync/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

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
            let total = 0;
            for (const c of this.counts) {
              total += c.count;
            }
            this.countTotal = total;
          } else if (msg.type === "operation_complete") {
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
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(SyncStore, import.meta.hot));
}
