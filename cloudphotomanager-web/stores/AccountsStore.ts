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
    _fetchPromise: null as Promise<void> | null,
  }),

  getters: {},

  actions: {
    /** Hydrate accounts from IndexedDB (non-blocking, called once). */
    async _hydrateFromCache() {
      if (this._hydrated) return;
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
        // Only mark hydrated when we actually got valid data
        this._hydrated = true;
      }
    },

    /**
     * Fetch accounts from the API. Deduplicated — if a fetch is already in
     * flight, the same promise is returned so callers never trigger
     * duplicate network requests.
     */
    async fetch() {
      if (this._fetchPromise) return this._fetchPromise;

      this._fetchPromise = (async () => {
        // Fire API call immediately — don't block on IndexedDB
        const apiPromise = axios
          .get(
            `${Config.sync.SERVER_URL}/accounts/`,
            await AuthService.getAuthHeader(),
          )
          .then(async (res) => {
            const accounts = sortBy(res.data.accounts, ["name"]);
            // Never overwrite with empty results (guards against API hiccups)
            if (accounts.length > 0) {
              this.accounts = accounts;
              this.accountSelected = accounts[0].id;
              // Persist to IndexedDB for next visit
              await localCache.put("accounts", CACHE_KEY, this.accounts);
            }
          })
          .catch(handleError);

        // Race: hydrate from cache in parallel (instant display if cached)
        await this._hydrateFromCache();

        // Wait for the API to finish (fresh data overwrites cache)
        await apiPromise;
      })().finally(() => {
        this._fetchPromise = null;
      });

      return this._fetchPromise;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AccountsStore, import.meta.hot));
}
