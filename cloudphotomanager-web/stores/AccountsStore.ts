import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import { sortBy } from "lodash";
import { localCache, TTL } from "~~/services/LocalCache";

const CACHE_KEY = "all";

export const AccountsStore = defineStore("AccountsStore", {
  state: () => ({
    accounts: [] as any[],
    accountSelected: "",
    _hydrated: false,
  }),

  getters: {},

  actions: {
    /** Hydrate accounts from IndexedDB (non-blocking, called once). */
    async _hydrateFromCache() {
      if (this._hydrated) return;
      this._hydrated = true;
      const cached = await localCache.get<any[]>(
        "accounts",
        CACHE_KEY,
        TTL.ACCOUNTS,
      );
      if (cached && cached.length > 0 && this.accounts.length === 0) {
        this.accounts = cached;
        if (!this.accountSelected && cached.length > 0) {
          this.accountSelected = cached[0].id;
        }
      }
    },

    async fetch() {
      // Hydrate from cache first for instant display
      await this._hydrateFromCache();

      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/`,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.accounts = sortBy(res.data.accounts, ["name"]);
          if (this.accounts.length > 0) {
            this.accountSelected = (this.accounts[0] as any).id;
          }
          // Persist to IndexedDB for next visit
          await localCache.put("accounts", CACHE_KEY, this.accounts);
        })
        .catch(handleError);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AccountsStore, import.meta.hot));
}
