import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import * as _ from "lodash";
import { PreferencesFolders } from "~~/services/PreferencesFolders";
import * as path from "path";

export const FoldersStore = defineStore("FoldersStore", {
  state: () => ({
    folders: [],
    loading: false,
  }),

  getters: {},

  actions: {
    async fetch(accountId: string) {
      this.loading = true;
      const folders: any[] = [];
      for (const accountIn of AccountsStore().accounts) {
        const account: any = accountIn;
        folders.push({ name: account.name, accountId: account.id, folderpath: "/", depth: 0 });
        await axios
          .get(`${(await Config.get()).SERVER_URL}/accounts/${account.id}/folders`, await AuthService.getAuthHeader())
          .then((res) => {
            for (const folder of _.sortBy(res.data.folders, ["folderpath"])) {
              if (folder.folderpath !== "/") {
                folders.push({
                  name: folder.folderpath.split("/").pop(),
                  type: "folder",
                  id: folder.id,
                  accountId: account.id,
                  folderpath: folder.folderpath,
                  childrenCount: folder.childrenCount,
                  indentation: this.getIndentation(folder.folderpath),
                  isCollapsed: PreferencesFolders.isCollapsed(folder.accountId, folder.id),
                  isVisible: true,
                });
              } else {
                folders[0].id = folder.id;
              }
            }
          })
          .catch(handleError);
        this.checkVisibility(folders, account.id);
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
      let parentCollapsedPath = "";
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i] as any;
        if (folder.accountId === accountId) {
          if (parentCollapsedPath && `${folder.folderpath}/`.indexOf(parentCollapsedPath) === 0) {
            folder.isVisible = false;
          } else if (!folder.isCollapsed) {
            folder.isVisible = true;
          } else if (folder.isCollapsed) {
            folder.isVisible = true;
            parentCollapsedPath = folder.folderpath;
          } else {
            folder.isVisible = true;
          }
        }
      }
    },
    toggleFolderCollapsed(index: number) {
      const folder = this.folders[index] as any;
      folder.isCollapsed = !folder.isCollapsed;
      PreferencesFolders.toggleCollapsed(folder.accountId, folder.id);
      this.checkVisibility(this.folders, folder.accountId);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(FoldersStore, import.meta.hot));
}
