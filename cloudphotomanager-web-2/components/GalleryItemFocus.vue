<template>
  <div class="file-preview">
    <i class="bi bi-x-circle action" v-on:click="clickedClose()"></i>
    <div v-if="authenticationStore.isAdmin" class="file-preview-operations">
      <button class="secondary outline" v-on:click="clickedDelete()"><i class="bi bi-trash-fill"></i> Delete</button>
      <button class="secondary outline" v-on:click="clickedMove()"><i class="bi bi-arrows-move"></i> Move...</button>
    </div>
    <DialogMove v-if="activeOperation == 'move'" :target="{ files: [file] }" @onDone="onOperationDone" />
    <div id="media-container">
      <img class="media-content" v-if="file && getType(file) == 'image'" :src="getImageSource(file)" />
      <video class="media-content" v-if="file && videoDelayedLoadingDone && getType(file) == 'video'" controls>
        <source :src="getVideoSource(file)" type="video/mp4" />
      </video>
    </div>
    <div id="media-preload">
      <img v-if="position > 0 && getType(files[position - 1]) == 'image'" :src="getImageSource(files[position - 1])" />
      <img
        v-if="position + 1 < files.length - 1 && getType(files[position + 1]) == 'image'"
        :src="getImageSource(files[position + 1])"
      />
    </div>
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { FileUtils } from "~~/services/FileUtils";
import * as Hammer from "hammerjs";
import * as _ from "lodash";

export default {
  props: {
    inputFiles: {},
  },
  data() {
    return {
      serverUrl: "",
      staticUrl: "",
      activeOperation: "",
      file: null,
      files: [],
      position: 0,
      videoDelayedLoadingDone: false,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this.staticUrl = (await Config.get()).STATIC_URL;

    this.files = this.inputFiles.files;
    this.position = this.inputFiles.position;
    this.loadMedia(true);

    const mediaContainer = document.querySelector("#media-container");
    const gestureManager = new Hammer.Manager(mediaContainer);
    gestureManager.add(new Hammer.Swipe());
    gestureManager.on("swipe", (event) => {
      if (event.offsetDirection === 2) {
        this.nextMedia();
      } else if (event.offsetDirection === 4) {
        this.previousMedia();
      }
    });
  },
  methods: {
    clickedClose() {
      this.$emit("onFileClosed", {});
    },
    clickedMove() {
      this.activeOperation = "move";
    },
    getType(file) {
      return FileUtils.getType(file);
    },
    async clickedDelete() {
      if (confirm(`Delete the file? (Can't be undone!)\nFile: ${this.file.filename} \n`) == true) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${this.file.accountId}/files/batch/operations/fileDelete`,
            { fileIdList: [this.file.id] },
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
    previousMedia() {
      if (this.files.length === 0 || this.position === 0) {
        return;
      }
      const mediaDomElement = document.querySelector(".media-content");
      mediaDomElement.classList.add("animate-media-out-right");
      setTimeout(() => {
        this.position--;
        this.loadMedia();
        this.file = this.files[this.position];
        mediaDomElement.classList.remove("animate-media-out-right");
        mediaDomElement.classList.add("animate-media-in-left");
      }, 300);
      setTimeout(() => {
        mediaDomElement.classList.remove("animate-media-in-left");
        mediaDomElement.classList.remove("animate-media-in-right");
      }, 700);
    },
    nextMedia() {
      if (this.files.length === 0 || this.position === this.files.length - 1) {
        return;
      }
      const mediaDomElement = document.querySelector(".media-content");
      mediaDomElement.classList.add("animate-media-out-left");
      setTimeout(() => {
        this.position++;
        this.loadMedia();
        mediaDomElement.classList.remove("animate-media-out-left");
        mediaDomElement.classList.add("animate-media-in-right");
      }, 300);
      setTimeout(() => {
        mediaDomElement.classList.remove("animate-media-in-right");
        mediaDomElement.classList.remove("animate-media-in-left");
      }, 700);
    },
    loadMedia(newRoute = false) {
      this.videoDelayedLoadingDone = false;
      this.file = this.files[this.position];
      if (newRoute) {
        useRouter().push({
          query: { accountId: this.file.accountId, folderId: this.file.folderId, fileId: this.file.id },
        });
      } else {
        useRouter().replace({
          query: { accountId: this.file.accountId, folderId: this.file.folderId, fileId: this.file.id },
        });
      }
      setTimeout(() => {
        this.videoDelayedLoadingDone = true;
      }, 100);
    },
    preloadFile(file) {
      const img = new Image();
      img.src = this.getImageSource(file);
    },
    getImageSource(file) {
      return (
        this.staticUrl + "/" + file.accountId + "/" + file.id[0] + "/" + file.id[1] + "/" + file.id + "/preview.webp"
      );
    },
    getVideoSource(file) {
      return (
        this.staticUrl + "/" + file.accountId + "/" + file.id[0] + "/" + file.id[1] + "/" + file.id + "/preview.mp4"
      );
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
#media-container {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: 1fr auto 1fr;
  width: 100vw;
  height: 100vh;
}
#media-container img {
  grid-column: 2;
  grid-row: 2;
  max-width: 100vw;
  max-height: 100vh;
  width: auto;
  height: auto;
  display: flex;
}
#media-container video {
  grid-column: 2;
  grid-row: 2;
  max-width: 100vw;
  max-height: 100vh;
  width: auto;
  height: auto;
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
.animate-media-out-left {
  animation-duration: 0.3s;
  opacity: 0;
  transition: 0.3s all ease-in-out;
  transform: translate(-100px, 0px);
}
.animate-media-out-right {
  animation-duration: 0.3s;
  opacity: 0;
  transition: 0.3s all ease-in-out;
  transform: translate(100px, 0px);
}
.animate-media-in-left {
  animation-duration: 0.3s;
  opacity: 1;
  transition: 0.3s all ease-in-out;
  animation-name: slidein-left;
}
.animate-media-in-right {
  animation-duration: 0.3s;
  opacity: 1;
  transition: 0.3s all ease-in-out;
  animation-name: slidein-right;
}
@keyframes slidein-left {
  from {
    transform: translate(-100px, 0px);
  }
  to {
    transform: translate(0px, 0px);
  }
}
@keyframes slidein-right {
  from {
    transform: translate(100px, 0px);
  }
  to {
    transform: translate(0px, 0px);
  }
}
@keyframes slideout-left {
  from {
    transform: translate(100px, 0px);
  }
  to {
    transform: translate(0px, 0px);
  }
}
@keyframes slideout-right {
  from {
    transform: translate(100px, 0px);
  }
  to {
    transform: translate(0px, 0px);
  }
}
#media-preload {
  width: 0px;
  height: 0px;
}
#media-preload img {
  width: 0px;
  height: 0px;
}
</style>
