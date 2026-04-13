<template>
  <div class="file-preview">
    <i class="bi bi-x-circle action" v-on:click="clickedClose()"></i>
    <div v-if="authenticationStore.isAdmin" class="file-preview-operations">
      <button class="secondary outline" v-on:click="clickedDelete()">
        <i class="bi bi-trash-fill"></i> Delete
      </button>
      <button class="secondary outline" v-on:click="clickedMove()">
        <i class="bi bi-arrows-move"></i> Move...
      </button>
    </div>
    <DialogMove
      v-if="activeOperation == 'move'"
      :target="{ files: [file] }"
      @onDone="onOperationDone"
    />
    <div id="media-container">
      <Loading v-if="mediaLoading" class="media-loading" />
      <img
        class="media-content"
        v-if="file && getType(file) == 'image'"
        :src="getImageSource(file)"
        ref="zoomableImage"
        :style="imageTransformStyle"
        :class="{ 'media-hidden': mediaLoading }"
        @load="onMediaLoaded"
        @error="onMediaLoaded"
        @wheel.prevent="onImageWheel"
        @mousedown="onImageMouseDown"
        @mousemove="onImageMouseMove"
        @mouseup="onImageMouseUp"
        @mouseleave="onImageMouseUp"
      />
      <template
        v-if="file && videoDelayedLoadingDone && getType(file) == 'video'"
      >
        <video
          class="media-content"
          v-if="!videoUnavailable"
          controls
          :class="{ 'media-hidden': mediaLoading }"
          @loadeddata="onMediaLoaded"
          @error="onVideoError"
        >
          <source
            :src="getVideoSource(file)"
            type="video/mp4"
            @error="onVideoError"
          />
        </video>
        <div v-else class="video-unavailable">
          <i class="bi bi-camera-video-off"></i>
          <p>Video not yet available</p>
        </div>
      </template>
    </div>
    <div id="media-preload">
      <img
        v-if="position > 0 && getType(files[position - 1]) == 'image'"
        :src="getImageSource(files[position - 1])"
      />
      <img
        v-if="
          position + 1 < files.length - 1 &&
          getType(files[position + 1]) == 'image'
        "
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
      videoUnavailable: false,
      mediaLoading: true,
      imageScale: 1,
      imageTranslateX: 0,
      imageTranslateY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      dragStartTranslateX: 0,
      dragStartTranslateY: 0,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this.staticUrl = (await Config.get()).STATIC_URL;

    this.files = this.inputFiles.files;
    this.position = this.inputFiles.position;
    this.loadMedia(true);

    this._onKeyDown = (event) => {
      if (event.key === "ArrowRight") this.nextMedia();
      else if (event.key === "ArrowLeft") this.previousMedia();
      else if (event.key === "Escape") this.clickedClose();
    };
    window.addEventListener("keydown", this._onKeyDown);

    const mediaContainer = document.querySelector("#media-container");
    const gestureManager = new Hammer.Manager(mediaContainer);
    gestureManager.add(new Hammer.Swipe({ threshold: 10, velocity: 0.3 }));
    gestureManager.add(new Hammer.Pinch({ enable: true }));
    gestureManager.add(
      new Hammer.Pan({ threshold: 5, pointers: 1, direction: Hammer.DIRECTION_ALL }),
    );
    gestureManager.get("swipe").requireFailure(gestureManager.get("pinch"));
    gestureManager.get("pan").requireFailure(gestureManager.get("swipe"));
    let pinchStartScale = 1;
    let panStartTranslateX = 0;
    let panStartTranslateY = 0;
    gestureManager.on("swipe", (event) => {
      if (this.imageScale > 1) return;
      if (event.offsetDirection === 2) {
        this.nextMedia();
      } else if (event.offsetDirection === 4) {
        this.previousMedia();
      }
    });
    gestureManager.on("pinchstart", () => {
      pinchStartScale = this.imageScale;
    });
    gestureManager.on("pinchmove", (event) => {
      this.imageScale = Math.min(
        10,
        Math.max(1, pinchStartScale * event.scale),
      );
      if (this.imageScale <= 1) {
        this.imageTranslateX = 0;
        this.imageTranslateY = 0;
      }
    });
    gestureManager.on("panstart", () => {
      if (this.imageScale <= 1) return;
      panStartTranslateX = this.imageTranslateX;
      panStartTranslateY = this.imageTranslateY;
    });
    gestureManager.on("panmove", (event) => {
      if (this.imageScale <= 1) return;
      this.imageTranslateX = panStartTranslateX + event.deltaX;
      this.imageTranslateY = panStartTranslateY + event.deltaY;
    });
  },
  unmounted() {
    window.removeEventListener("keydown", this._onKeyDown);
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
      if (
        confirm(
          `Delete the file? (Can't be undone!)\nFile: ${this.file.filename} \n`,
        ) == true
      ) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${this.file.accountId}/files/batch/operations/fileDelete`,
            { fileIdList: [this.file.id] },
            await AuthService.getAuthHeader(),
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
      this.videoUnavailable = false;
      this.mediaLoading = true;
      this.imageScale = 1;
      this.imageTranslateX = 0;
      this.imageTranslateY = 0;
      this.file = this.files[this.position];
      if (newRoute) {
        useRouter().push({
          query: {
            accountId: this.file.accountId,
            folderId: this.file.folderId,
            fileId: this.file.id,
          },
        });
      } else {
        useRouter().replace({
          query: {
            accountId: this.file.accountId,
            folderId: this.file.folderId,
            fileId: this.file.id,
          },
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
        this.staticUrl +
        "/" +
        file.accountId +
        "/" +
        file.id[0] +
        "/" +
        file.id[1] +
        "/" +
        file.id +
        "/preview.webp"
      );
    },
    getVideoSource(file) {
      return (
        this.staticUrl +
        "/" +
        file.accountId +
        "/" +
        file.id[0] +
        "/" +
        file.id[1] +
        "/" +
        file.id +
        "/preview.mp4"
      );
    },
    onMediaLoaded() {
      this.mediaLoading = false;
    },
    onVideoError() {
      this.videoUnavailable = true;
      this.mediaLoading = false;
    },
    onImageWheel(event) {
      const delta = event.deltaY > 0 ? -0.15 : 0.15;
      this.imageScale = Math.min(10, Math.max(1, this.imageScale + delta));
      if (this.imageScale <= 1) {
        this.imageTranslateX = 0;
        this.imageTranslateY = 0;
      }
    },
    onImageMouseDown(event) {
      if (this.imageScale <= 1) return;
      this.isDragging = true;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragStartTranslateX = this.imageTranslateX;
      this.dragStartTranslateY = this.imageTranslateY;
      event.preventDefault();
    },
    onImageMouseMove(event) {
      if (!this.isDragging) return;
      this.imageTranslateX =
        this.dragStartTranslateX + (event.clientX - this.dragStartX);
      this.imageTranslateY =
        this.dragStartTranslateY + (event.clientY - this.dragStartY);
    },
    onImageMouseUp() {
      this.isDragging = false;
    },
  },
  computed: {
    imageTransformStyle() {
      return {
        transform: `scale(${this.imageScale}) translate(${this.imageTranslateX / this.imageScale}px, ${this.imageTranslateY / this.imageScale}px)`,
        cursor:
          this.imageScale > 1
            ? this.isDragging
              ? "grabbing"
              : "grab"
            : "default",
        transition: this.isDragging ? "none" : "transform 0.1s ease-out",
        transformOrigin: "center center",
        userSelect: "none",
      };
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
  position: relative;
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
  z-index: 100;
  cursor: pointer;
}
.file-preview-operations {
  font-size: 1.5em;
  position: fixed;
  bottom: 1em;
  right: 1em;
  color: #aaf;
  z-index: 100;
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
.media-loading {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
}
.media-hidden {
  visibility: hidden;
}
.video-unavailable {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75em;
  color: #aaf;
  opacity: 0.7;
  font-size: 1.2em;
}
.video-unavailable i {
  font-size: 3em;
}
.video-unavailable p {
  margin: 0;
}
</style>
