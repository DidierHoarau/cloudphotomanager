import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";

export const SyncStore = defineStore("SyncStore", {
  state: () => ({
    countTotal: 0,
    countBlocking: 0,
    counts: [],
    checkFrequencyMin: 800,
    checkFrequency: 1000,
    checkFrequencyMax: 30000,
    checking: false,
    monitoring: false,
    lastUpdate: new Date(),
  }),

  actions: {
    async monitor() {
      if (this.checking) {
        return;
      }
      this.checking = true;
      this.checkFrequency = Math.min(this.checkFrequencyMax, this.checkFrequency + this.checkFrequencyMin);
      await axios
        .get(`${(await Config.get()).SERVER_URL}/sync/status`, await AuthService.getAuthHeader())
        .then(async (res) => {
          let count = 0;
          for (const item of res.data.sync) {
            count += item.count;
            if (item.type === "blocking") {
              this.countBlocking = item.count;
            }
          }
          this.countTotal = count;
          let latestUpdate = this.lastUpdate;
          for (const recentEvent of res.data.recentEvents) {
            if (new Date(recentEvent.date) <= this.lastUpdate) {
              continue;
            }
            this.checkFrequency = this.checkFrequencyMin;
            if (latestUpdate < new Date(recentEvent.date)) {
              latestUpdate = new Date(recentEvent.date);
              if (recentEvent.objectType === "folder") {
                EventBus.emit(EventTypes.FOLDER_UPDATED, {
                  folderId: recentEvent.objectId,
                  accountId: recentEvent.accountId,
                  action: recentEvent.action,
                });
              }
            }
          }
          this.lastUpdate = latestUpdate;
        })
        .catch((err) => {
          console.error(err);
        });
      setTimeout(() => {
        this.checking = false;
        this.monitor();
      }, this.checkFrequency);
    },
    markOperationInProgress() {
      this.countBlocking++;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(SyncStore, import.meta.hot));
}
