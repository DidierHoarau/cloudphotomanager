import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import { sortBy } from "lodash";

export const AccountsStore = defineStore("AccountsStore", {
  state: () => ({
    accounts: [],
    accountSelected: "",
  }),

  getters: {},

  actions: {
    async fetch() {
      await axios
        .get(`${(await Config.get()).SERVER_URL}/accounts/`, await AuthService.getAuthHeader())
        .then((res) => {
          this.accounts = sortBy(res.data.accounts, ["name"]);
          if (this.accounts.length > 0) {
            this.accountSelected = (this.accounts[0] as any).id;
          }
        })
        .catch(handleError);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AccountsStore, import.meta.hot));
}
