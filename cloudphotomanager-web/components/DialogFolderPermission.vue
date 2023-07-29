<template>
  <dialog open>
    <article>
      <header>
        <a href="#close" aria-label="Close" class="close" v-on:click="clickedClose()"></a>
        Move File
      </header>
      <label>Add Folder Permission</label>
      <FolderList class="dialog-folder-selection" @onFolderSelected="onFolderSelected" />
      <input id="name" v-model="selectedFolderpath" type="text" />
      <button :disabled="loading || selectedFolderpath === ''" v-on:click="doAction()">Add</button>
    </article>
  </dialog>
</template>

<script setup>
const foldersStore = FoldersStore();
</script>

<script>
import axios from "axios";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import * as _ from "lodash";

export default {
  props: {
    userId: "",
  },
  data() {
    return {
      serverUrl: "",
      selectedFolderpath: "",
      selectedFolder: null,
      loading: false,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
  },
  methods: {
    async clickedClose() {
      this.$emit("onDone", {});
    },
    onFolderSelected(event) {
      this.selectedFolderpath = event.folder.folderpath;
      this.selectedFolder = event.folder;
    },
    async doAction() {
      this.loading = true;
      await axios
        .get(`${(await Config.get()).SERVER_URL}/users/${this.userId}/permissions`, await AuthService.getAuthHeader())
        .then(async (res) => {
          const permissions = res.data;
          if (!permissions.info.folders) {
            permissions.info.folders = [];
          }
          const folderPermission = _.find(permissions.folders, { folderId: this.selectedFolder.id });
          if (!folderPermission) {
            permissions.info.folders.push({ folderId: this.selectedFolder.id, scope: "ro" });
          }
          await axios.put(
            `${(await Config.get()).SERVER_URL}/users/${this.userId}/permissions`,
            permissions,
            await AuthService.getAuthHeader()
          );
          this.$emit("onDone", { status: "invalidated" });
        })
        .catch(handleError);
      this.loading = false;
    },
  },
};
</script>

<style scoped>
.dialog-folder-selection {
  width: 100%;
  min-width: 20em;
  height: 15em;
}
.file-preview img {
  max-width: 100%;
  height: auto;
  max-height: 100%;
}
.file-preview .action {
  font-size: 1.5em;
  position: fixed;
  right: 1em;
  top: 1em;
  color: #aaf;
}
.file-preview-operations {
  font-size: 1.5em;
  position: fixed;
  bottom: 1em;
  right: 1em;
  color: #aaf;
}
.file-preview-operations button {
  padding: 0.3em 0.7em;
  font-size: 0.5em;
  opacity: 0.5;
}
</style>
