<template>
  <div class="file-preview">
    <i class="bi bi-x-circle action" v-on:click="clickedClose()"></i>
    <div class="file-preview-operations">
      <button class="secondary outline" v-on:click="clickedMove()">Move...</button>
    </div>
    <DialogMove v-if="activeOperation == 'move'" :file="file" @onDone="onOperationDone" />
    <img :src="serverUrl + '/accounts/' + file.accountId + '/files/' + file.id + '/preview'" />
  </div>
</template>

<script>
import axios from "axios";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";

export default {
  props: {
    file: {},
  },
  data() {
    return {
      serverUrl: "",
      activeOperation: "",
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
  },
  methods: {
    clickedClose() {
      this.$emit("onFileClosed", {});
    },
    clickedMove() {
      this.activeOperation = "move";
    },
    onOperationDone(result) {
      if (result.status === "invalidated") {
        this.$emit("onFileClosed", { status: "invalidated" });
        this.$emit("onFileClosed", { status: "invalidated" });
      }
      this.activeOperation = "";
    },
  },
};
</script>

<style scoped>
.file-preview {
  width: 100%;
  height: 100%;
  text-align: center;
  display: flex;
  align-items: center;
}
.file-preview img {
  max-width: 100%;
  max-height: 100%;
  display: block;
  height: auto;
  margin: auto;
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
