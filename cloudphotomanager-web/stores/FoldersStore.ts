import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import { find, findIndex, sortBy } from "lodash";
import { PreferencesFolders } from "~~/services/PreferencesFolders";

export const FoldersStore = defineStore("FoldersStore", {
  state: () => ({
    folders: [],
    loading: false,
  }),

  getters: {},

  actions: {
    async fetch() {
      if (this.folders.length === 0) {
        this.loading = true;
      }
      const folders: any[] = [];
      for (const accountIn of AccountsStore().accounts) {
        const account: any = accountIn;
        await axios
          .get(`${(await Config.get()).SERVER_URL}/accounts/${account.id}/folders`, await AuthService.getAuthHeader())
          .then((res) => {
            for (const folder of sortBy(res.data.folders, ["folderpath"])) {
              if (folder.folderpath === "/") {
                folders.push({
                  id: folder.id,
                  name: account.name,
                  accountId: account.id,
                  folderpath: "/",
                  depth: 0,
                  parentIndex: -1,
                  isCollapsed: PreferencesFolders.isCollapsed(folder.accountId, folder.id),
                  isVisible: true,
                  children: 0,
                });
              } else {
                let parentPath = folder.folderpath.substring(0, folder.folderpath.lastIndexOf("/"));
                if (parentPath === "") {
                  parentPath = "/";
                }
                const parentIndex = findIndex(folders, { folderpath: parentPath, accountId: account.id });
                folders.push({
                  id: folder.id,
                  name: folder.folderpath.split("/").pop(),
                  type: "folder",
                  accountId: account.id,
                  folderpath: folder.folderpath,
                  childrenCount: folder.childrenCount,
                  indentation: this.getIndentation(folder.folderpath),
                  isCollapsed: PreferencesFolders.isCollapsed(folder.accountId, folder.id),
                  isVisible: true,
                  parentIndex,
                  children: 0,
                });
                folders[parentIndex].children++;
              }
            }
          })
          .catch(handleError);
        this.checkVisibility(folders, account.id);
        this.fetchCounts(folders, account.id);
      }
      (this.folders as any[]) = folders;
      this.loading = false;
    },
    getIndentation(folderpath: string) {
      if (folderpath === "/") {
        return "";
      }
      let indent = "";
      for (let i = 0; i < folderpath.split("/").length - 1; i++) {
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
        if (!folders[folder.parentIndex].isVisible || folders[folder.parentIndex].isCollapsed) {
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
          await AuthService.getAuthHeader()
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
    getParentFolder(folder: any) {
      return this.folders[folder.parentIndex];
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(FoldersStore, import.meta.hot));
}
