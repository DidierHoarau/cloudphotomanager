<template>
  <div class="file-preview">
    <i class="bi bi-x-circle action" v-on:click="clickedClose()"></i>
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
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
  },
  methods: {
    async clickedClose() {
      this.$emit("onFileClosed", {});
    },
  },
};
</script>

<style scoped>
.file-preview {
  width: 100%;
  height: 100%;
  text-align: center;
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
</style>
