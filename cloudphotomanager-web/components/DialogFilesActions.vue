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
        File Actions
      </header>
      <label
        >{files.length} file{{ files.length > 1 ? "" : "s" }} selected</label
      >
      <button v-on:click="doActionRecache()">
        Recache File{{ files.length > 1 ? "" : "s" }}
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
    target: {},
  },
  data() {
    return {
      serverUrl: "",
      selectedFolderpath: "",
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
    async doActionRecache() {
      // this.loading = true;
      // for (const file of this.target.files) {
      //   await axios
      //     .put(
      //       `${(await Config.get()).SERVER_URL}/accounts/${file.accountId}/files/${file.id}/operations/folder`,
      //       {
      //         folderpath: this.selectedFolderpath,
      //       },
      //       await AuthService.getAuthHeader()
      //     )
      //     .then((res) => {
      //       this.$emit("onDone", { status: "invalidated" });
      //       EventBus.emit(EventTypes.FOLDERS_UPDATED, {});
      //     })
      //     .catch(handleError);
      // }
      // this.loading = false;
    },
  },
};
</script>

<style scoped></style>
