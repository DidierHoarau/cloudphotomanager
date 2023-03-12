import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import * as _ from "lodash";

export const AccountsStore = defineStore("AccountsStore", {
  state: () => ({
    accounts: "",
  }),

  getters: {},

  actions: {
    async fetch() {
      await axios
        .get(`${(await Config.get()).SERVER_URL}/accounts/`, await AuthService.getAuthHeader())
        .then((res) => {
          this.accounts = _.sortBy(res.data.accounts, ["name"]);
        })
        .catch(handleError);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AccountsStore, import.meta.hot));
}
