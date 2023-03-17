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
    // async selectFolder(sourceId: string) {
    //   const sourceItemsStore = SourceItemsStore();
    //   if (!sourceId) {
    //     sourceItemsStore.selectedSource = "";
    //     sourceItemsStore.page = 1;
    //     sourceItemsStore.searchCriteria = "all";
    //     sourceItemsStore.filterStatus = "unread";
    //     sourceItemsStore.fetch();
    //   }
    //   const position = _.findIndex(this.sources, { sourceId });
    //   if (position < 0) {
    //     return;
    //   }
    //   this.selectedIndex = position;
    //   sourceItemsStore.selectedSource = sourceId;
    //   sourceItemsStore.searchCriteria = "sourceId";
    //   sourceItemsStore.searchCriteriaValue = sourceId;
    //   sourceItemsStore.page = 1;
    //   sourceItemsStore.fetch();
    // },
    async select(folder: any) {
      // console.log(folder, "bar");
    },
    async fetch(accountId: string) {
      const folders: any[] = [];
      for (const accountIn of AccountsStore().accounts) {
        const account: any = accountIn;
        folders.push({ name: account.name, type: "account", folderpath: "/", depth: 0 });
        await axios
          .get(`${(await Config.get()).SERVER_URL}/accounts/${account.id}/folders`, await AuthService.getAuthHeader())
          .then((res) => {
            for (const folder of _.sortBy(res.data.folders, ["folderpath"])) {
              folders.push({
                name: folder.folderpath.split("/").pop(),
                type: "folder",
                folderpath: folder.folderpath,
                depth: folder.folderpath.split("/").length - 1,
              });
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
