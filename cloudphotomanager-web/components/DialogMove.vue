<template>
  <dialog open>
    <article>
      <header>
        <a href="#close" aria-label="Close" class="close" v-on:click="clickedClose()"></a>
        Move File
      </header>
      <label>Destination Folder</label>
      <FolderList
        v-if="accountId"
        class="dialog-folder-selection"
        :accountId="accountId"
        @onFolderSelected="onFolderSelected"
      />
      <input id="name" v-model="selectedFolderpath" type="text" />
      <button :disabled="loading || selectedFolderpath === ''" v-on:click="doAction()">Move</button>
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

export default {
  props: {
    target: {},
  },
  data() {
    return {
      serverUrl: "",
      selectedFolderpath: "",
      loading: false,
      accountId: "",
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this.accountId = this.target.files[0].accountId;
  },
  methods: {
    async clickedClose() {
      this.$emit("onDone", {});
    },
    onFolderSelected(event) {
      if (event.folder.accountId !== this.target.files[0].accountId) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Destination must be in the same account",
        });
        return;
      }
      this.selectedFolderpath = event.folder.folderpath;
    },
    async doAction() {
      this.loading = true;
      SyncStore().markOperationInProgress();
      for (const file of this.target.files) {
        axios
          .put(
            `${(await Config.get()).SERVER_URL}/accounts/${file.accountId}/files/${file.id}/operations/folder`,
            {
              folderpath: this.selectedFolderpath,
            },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            this.$emit("onDone", { status: "invalidated" });
            EventBus.emit(EventTypes.FOLDERS_UPDATED, {});
            SyncStore().fetch();
          })
          .catch(handleError);
      }
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
