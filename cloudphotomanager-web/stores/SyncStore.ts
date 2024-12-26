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
    checkFrequency: 1000,
    checking: false,
  }),

  actions: {
    async fetch() {
      if (this.checking) {
        return;
      }
      this.checking = true;
      await axios
        .get(`${(await Config.get()).SERVER_URL}/sync/status`, await AuthService.getAuthHeader())
        .then(async (res) => {
          let count = 0;
          for (const item of res.data.sync) {
            count += item.count;
            if (item.type === "blocking") {
              if (item.count === 0) {
                await FoldersStore().fetch();
              }
              this.countBlocking = item.count;
            }
          }
          this.countTotal = count;
        })
        .catch((err) => {
          console.error(err);
        });
      this.checking = false;
      if (this.countBlocking > 0) {
        this.checkFrequency = 1000;
      } else {
        this.checkFrequency = 10 * 1000;
      }
      Timeout.wait(this.checkFrequency).then(() => {
        this.fetch();
      });
    },
    markOperationInProgress() {
      this.countBlocking++;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(SyncStore, import.meta.hot));
}
