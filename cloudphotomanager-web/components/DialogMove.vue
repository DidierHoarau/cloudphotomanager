<template>
  <dialog open>
    <article>
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedClose()"
        ></a>
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
      <button
        :disabled="loading || selectedFolderpath === ''"
        v-on:click="doAction()"
      >
        Move
      </button>
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
    files: {
      type: Array,
      required: true,
    },
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
    this.accountId = this.files[0].accountId;
  },
  methods: {
    async clickedClose() {
      this.$emit("onDone", {});
    },
    onFolderSelected(event) {
      if (event.folder.accountId !== this.files[0].accountId) {
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
      const fileIdList = this.files.map((f) => f.id);
      SyncStore().markFilesAsPending(fileIdList);
      SyncStore().markOperationInProgress();
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/accounts/${this.accountId}/files/batch/operations/folderMove`,
          {
            folderpath: this.selectedFolderpath,
            fileIdList,
          },
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          // Close dialog; gallery will refresh when OPERATION_COMPLETE fires
          this.$emit("onDone", {});
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
</style>
