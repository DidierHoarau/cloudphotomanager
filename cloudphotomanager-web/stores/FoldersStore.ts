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
  }),

  getters: {},

  actions: {
    /** Hydrate folders from IndexedDB for instant display on revisit. */
    async _hydrateFromCache() {
      if (this._hydrated) return;
      this._hydrated = true;
      const cached = await localCache.get<any[]>(
        "folders",
        CACHE_KEY,
        TTL.FOLDERS,
      );
      if (cached && cached.length > 0 && this.folders.length === 0) {
        this.folders = cached;
      }
    },

    async fetch() {
      const accounts = AccountsStore().accounts;
      if (this.folders.length === 0) {
        this.loading = true;
      }

      // Fire folder API calls immediately — don't block on IndexedDB
      const folderResultsPromise = Promise.allSettled(
        accounts.map(async (accountIn: any) => {
          const account = accountIn;
          const res = await axios.get(
            `${(await Config.get()).SERVER_URL}/accounts/${account.id}/folders`,
            await AuthService.getAuthHeader(),
          );
          return { account, folders: res.data.folders };
        }),
      );

      // Race: hydrate from IDB cache in parallel (instant display if cached)
      await this._hydrateFromCache();

      // Wait for folder API responses
      const folderResults = await folderResultsPromise;

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
            folders[parentIndex].children++;
          }
        }
        this.checkVisibility(folders, account.id);
      }

      // Fetch counts for all accounts in parallel
      await Promise.allSettled(
        accounts.map((accountIn: any) =>
          this.fetchCounts(folders, accountIn.id),
        ),
      );

      (this.folders as any[]) = folders;
      this.loading = false;

      // Persist processed folder tree to IndexedDB for next visit
      await localCache.put("folders", CACHE_KEY, folders);
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
          `${(await Config.get()).SERVER_URL}/accounts/${accountId}/folders/counts`,
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
