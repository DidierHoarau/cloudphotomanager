<template>
  <div class="file-preview">
    <i class="bi bi-x-circle action" v-on:click="clickedClose()"></i>
    <div class="file-preview-operations">
      <button class="secondary outline" v-on:click="clickedDelete()"><i class="bi bi-trash-fill"></i> Delete</button>
      <button class="secondary outline" v-on:click="clickedMove()"><i class="bi bi-arrows-move"></i> Move...</button>
    </div>
    <DialogMove v-if="activeOperation == 'move'" :target="{ files: [file] }" @onDone="onOperationDone" />
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
    async clickedDelete() {
      if (confirm(`Delete the file? (Can't be undone!)\nFile: ${this.file.filename} \n`) == true) {
        await axios
          .delete(
            `${(await Config.get()).SERVER_URL}/accounts/${this.file.accountId}/files/${
              this.file.id
            }/operations/delete`,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "File deleted",
            });
            this.onOperationDone({ status: "invalidated" });
          })
          .catch(handleError);
      }
    },
    onOperationDone(result) {
      if (result.status === "invalidated") {
        this.$emit("onFileClosed", { status: "invalidated" });
      }
      this.activeOperation = "";
      EventBus.emit(EventTypes.FOLDER_UPDATED, {});
      EventBus.emit(EventTypes.FILE_UPDATED, {});
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
