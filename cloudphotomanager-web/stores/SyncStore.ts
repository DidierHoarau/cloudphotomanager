import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";

export const SyncStore = defineStore("SyncStore", {
  state: () => ({
    countTotal: 0,
    counts: [],
    checkFrequency: 15 * 1000,
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
        .then((res) => {
          let count = 0;
          for (const item of res.data.sync) {
            count += item.count;
          }
          this.countTotal = count;
        })
        .catch((err) => {
          console.error(err);
        });
      this.checking = false;
      Timeout.wait(this.checkFrequency).then(() => {
        this.fetch();
      });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(SyncStore, import.meta.hot));
}
