import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import * as _ from "lodash";
import { PreferencesLabels } from "~~/services/PreferencesLabels";

export const FoldersStore = defineStore("FoldersStore", {
  state: () => ({
    folders: [],
    selectedIndex: -1,
  }),

  getters: {},

  actions: {
    async fetch(accountId: string) {
      const folders: any[] = [];
      for (const accountIn of AccountsStore().accounts) {
        const account: any = accountIn;
        folders.push({ name: account.name, folderpath: "/", depth: 0 });
        await axios
          .get(`${(await Config.get()).SERVER_URL}/accounts/${account.id}/folders`, await AuthService.getAuthHeader())
          .then((res) => {
            for (const folder of _.sortBy(res.data.folders, ["folderpath"])) {
              if (folder.folderpath !== "/") {
                let basePath = "";
                for (let i = 1; i < folder.folderpath.split("/").length - 1; i++) {
                  basePath += "/" + folder.folderpath.split("/")[i];
                  const newFolderTree = {
                    name: basePath.split("/").pop(),
                    folderpath: basePath,
                  };
                  if (!_.find(folders, { folderpath: newFolderTree.folderpath })) {
                    folders.push(newFolderTree);
                  }
                }
                folders.push({
                  name: folder.folderpath.split("/").pop(),
                  type: "folder",
                  folderpath: folder.folderpath,
                  childrenCount: folder.childrenCount,
                });
              }
            }
          })
          .catch(handleError);
      }
      (this.folders as any[]) = folders;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(FoldersStore, import.meta.hot));
}
