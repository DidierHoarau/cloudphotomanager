import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import { find, findIndex, sortBy } from "lodash";
import { PreferencesFolders } from "~~/services/PreferencesFolders";
import { localCache, TTL } from "~~/services/LocalCache";

const CACHE_KEY = "all";

export const FoldersStore = defineStore("FoldersStore", {
  state: () => ({
    folders: [] as any[],
    loading: false,
    _hydrated: false,
    _loadPromise: null as Promise<void> | null,
  }),

  getters: {},

  actions: {
    /** Hydrate folders from IndexedDB for instant display on revisit. */
    async _hydrateFromCache() {
      if (this._hydrated) return;
      const cached = await localCache.get<any[]>(
        "folders",
        CACHE_KEY,
        TTL.FOLDERS,
      );
      if (cached && cached.length > 0 && this.folders.length === 0) {
        this.folders = cached;
        // Only mark hydrated when we actually got valid data
        this._hydrated = true;
      }
    },

    /**
     * Single entry point for loading folders. Idempotent and deduplicated:
     * 1. Hydrates from IndexedDB cache (instant display)
     * 2. Ensures accounts are loaded
     * 3. Fetches fresh folder tree from the API
     * 4. Shows the tree immediately, then fetches counts in the background
     *
     * Multiple callers calling `ensureLoaded()` concurrently will share the
     * same in-flight promise — no duplicate network requests.
     */
    async ensureLoaded() {
      if (this._loadPromise) return this._loadPromise;

      this._loadPromise = (async () => {
        // 1. Instant hydration from cache
        await this._hydrateFromCache();

        // 2. Ensure accounts are loaded (deduplicated internally)
        await AccountsStore().fetch();

        // 3. Fetch fresh folder tree from API
        await this._fetchFromApi();
      })()
        .catch(handleError)
        .finally(() => {
          this._loadPromise = null;
        });

      return this._loadPromise;
    },

    /** Backward-compatible alias for ensureLoaded(). */
    async fetch() {
      return this.ensureLoaded();
    },

    /**
     * Fetch the folder tree from the API, process it, and display it
     * immediately. Counts are fetched in the background.
     */
    async _fetchFromApi() {
      const accounts = AccountsStore().accounts;
      if (accounts.length === 0) {
        // No accounts yet — don't touch folders or cache.
        return;
      }

      if (this.folders.length === 0) {
        this.loading = true;
      }

      // Fire folder API calls for all accounts in parallel
      const folderResults = await Promise.allSettled(
        accounts.map(async (accountIn: any) => {
          const account = accountIn;
          const res = await axios.get(
            `${Config.sync.SERVER_URL}/accounts/${account.id}/folders`,
            await AuthService.getAuthHeader(),
          );
          return { account, folders: res.data.folders };
        }),
      );

      const folders: any[] = [];
      for (const result of folderResults) {
        if (result.status !== "fulfilled") {
          handleError(result.reason);
          continue;
        }
        const { account } = result.value;
        for (const folder of sortBy(result.value.folders, ["folderpath"])) {
          if (folder.folderpath === "/") {
            folders.push({
              id: folder.id,
              name: account.name,
              accountId: account.id,
              folderpath: "/",
              depth: 0,
              parentIndex: -1,
              indentation: "",
              isCollapsed: PreferencesFolders.isCollapsed(
                folder.accountId,
                folder.id,
              ),
              isVisible: true,
              children: 0,
            });
          } else {
            let parentPath = getParentFolderPath(folder.folderpath);
            if (parentPath === "") {
              parentPath = "/";
            }
            const parentIndex = findIndex(folders, {
              folderpath: parentPath,
              accountId: account.id,
            });
            folders.push({
              id: folder.id,
              name: folder.folderpath.split("/").pop(),
              type: "folder",
              accountId: account.id,
              folderpath: formatFolderPath(folder.folderpath),
              childrenCount: folder.childrenCount,
              indentation: this.getIndentation(folder.folderpath),
              isCollapsed: PreferencesFolders.isCollapsed(
                folder.accountId,
                folder.id,
              ),
              isVisible: true,
              parentIndex,
              children: 0,
            });
            if (parentIndex >= 0) {
              folders[parentIndex].children++;
            }
          }
        }
        this.checkVisibility(folders, account.id);
      }

      // Display the folder tree immediately — don't wait for counts
      if (folders.length > 0) {
        this.folders = folders;
      }
      this.loading = false;

      // Persist processed folder tree to IndexedDB (never cache empty results)
      if (folders.length > 0) {
        await localCache.put("folders", CACHE_KEY, folders);
      }

      // Fetch counts in the background — don't block the tree display
      this._fetchCountsInBackground(folders, accounts);
    },

    /**
     * Fetch folder counts without blocking the tree display.
     * Updates individual folder objects reactively as counts arrive.
     */
    _fetchCountsInBackground(folders: any[], accounts: any[]) {
      Promise.allSettled(
        accounts.map((accountIn: any) =>
          this.fetchCounts(folders, accountIn.id),
        ),
      ).catch(() => {
        /* counts are non-critical */
      });
    },

    getIndentation(folderpath: string) {
      let indent = "";
      for (let i = 1; i < folderpath.split("/").length; i++) {
        indent += "&nbsp;&nbsp;&nbsp;&nbsp;";
      }
      return indent;
    },
    checkVisibility(folders: any[], accountId: string) {
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i] as any;
        if (folder.accountId !== accountId) {
          continue;
        }
        if (folder.parentIndex < 0) {
          folder.isVisible = true;
          continue;
        }
        if (
          !folders[folder.parentIndex].isVisible ||
          folders[folder.parentIndex].isCollapsed
        ) {
          folder.isVisible = false;
          continue;
        }
        folder.isVisible = true;
      }
    },
    async fetchCounts(folders: any[], accountId: string) {
      const counts = (
        await axios.get(
          `${Config.sync.SERVER_URL}/accounts/${accountId}/folders/counts`,
          await AuthService.getAuthHeader(),
        )
      ).data.counts;
      for (let element of counts) {
        const folder = find(folders, { accountId, id: element.folderId });
        if (folder) {
          folder.counts = element.counts;
        }
      }
    },
    toggleFolderCollapsed(index: number) {
      const folder = this.folders[index] as any;
      folder.isCollapsed = !folder.isCollapsed;
      PreferencesFolders.toggleCollapsed(folder.accountId, folder.id);
      this.checkVisibility(this.folders, folder.accountId);
    },
    expandToFolder(folderId: string) {
      // Walk up the parent chain and un-collapse each ancestor
      const folders = this.folders as any[];
      let current = folders.find((f) => f.id === folderId);
      if (!current) {
        return;
      }
      const accountId = current.accountId;
      const ancestorIndices: number[] = [];
      while (current && current.parentIndex >= 0) {
        ancestorIndices.push(current.parentIndex);
        current = folders[current.parentIndex];
      }
      // Un-collapse from the top-most ancestor down
      for (const idx of ancestorIndices.reverse()) {
        const ancestor = folders[idx] as any;
        if (ancestor.isCollapsed) {
          ancestor.isCollapsed = false;
          PreferencesFolders.setCollapsed(
            ancestor.accountId,
            ancestor.id,
            false,
          );
        }
      }
      if (ancestorIndices.length > 0) {
        this.checkVisibility(folders, accountId);
      }
    },
    getParentFolder(folder: any) {
      return this.folders[folder.parentIndex];
    },

    /** Invalidate the cached folder tree (called on sync events). */
    async invalidateCache() {
      this._hydrated = false;
      await localCache.delete("folders", CACHE_KEY);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(FoldersStore, import.meta.hot));
}

function formatFolderPath(str: string) {
  if (!str.endsWith("/")) {
    return str + "/";
  }
  return str;
}

function getParentFolderPath(path: string) {
  if (!path.endsWith("/")) {
    path += "/";
  }
  const segments = path.slice(0, -1).split("/");
  segments.pop();
  return segments.length > 0 ? segments.join("/") + "/" : "/";
}
