<template>
  <div class="file-preview">
    <DialogMove
      v-if="activeOperation == 'move'"
      :target="{ files: [file] }"
      @onDone="onOperationDone"
    />
    <div class="action-bar" :class="{ expanded: actionBarExpanded }">
      <button
        class="action-bar-toggle"
        @click="actionBarExpanded = !actionBarExpanded"
      >
        <i
          :class="
            actionBarExpanded ? 'bi bi-chevron-left' : 'bi bi-chevron-right'
          "
        ></i>
      </button>
      <div class="action-bar-content">
        <button
          class="action-btn"
          @click="previousMedia()"
          :disabled="position === 0"
          title="Previous"
        >
          <i class="bi bi-arrow-left"></i>
        </button>
        <button
          class="action-btn"
          @click="nextMedia()"
          :disabled="position === files.length - 1"
          title="Next"
        >
          <i class="bi bi-arrow-right"></i>
        </button>
        <div class="action-bar-divider"></div>
        <button
          class="action-btn"
          v-if="file && getType(file) == 'image'"
          @click="rotateImage()"
          title="Rotate"
        >
          <i class="bi bi-arrow-clockwise"></i>
        </button>
        <div
          class="action-bar-divider"
          v-if="authenticationStore.isAdmin"
        ></div>
        <template v-if="authenticationStore.isAdmin">
          <button class="action-btn" @click="clickedMove()" title="Move">
            <i class="bi bi-arrows-move"></i>
          </button>
          <button
            class="action-btn action-btn-danger"
            @click="clickedDelete()"
            title="Delete"
          >
            <i class="bi bi-trash-fill"></i>
          </button>
        </template>
        <div class="action-bar-divider"></div>
        <button class="action-btn" @click="clickedClose()" title="Close">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
    <div id="media-container" ref="mediaContainer">
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
      actionBarExpanded: false,
      file: null,
      files: [],
      position: 0,
      videoDelayedLoadingDone: false,
      videoUnavailable: false,
      mediaLoading: true,
      imageScale: 1,
      imageRotation: 0,
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
  },
  mounted() {
    const mediaContainer = this.$refs.mediaContainer;
    if (!mediaContainer) return;
    const gestureManager = new Hammer.Manager(mediaContainer, {
      touchAction: "none",
    });
    gestureManager.add(new Hammer.Pinch({ enable: true }));
    gestureManager.add(
      new Hammer.Swipe({
        threshold: 10,
        velocity: 0.3,
        direction: Hammer.DIRECTION_HORIZONTAL,
      }),
    );
    gestureManager.add(
      new Hammer.Pan({
        threshold: 5,
        pointers: 1,
        direction: Hammer.DIRECTION_ALL,
      }),
    );
    gestureManager.get("swipe").requireFailure(gestureManager.get("pinch"));
    gestureManager.get("pan").requireFailure(gestureManager.get("pinch"));
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
    gestureManager.on("panend", (event) => {
      if (this.imageScale > 1) return;
      if (event.deltaX < -50 || event.velocityX < -0.3) {
        this.nextMedia();
      } else if (event.deltaX > 50 || event.velocityX > 0.3) {
        this.previousMedia();
      }
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
      this.imageRotation = 0;
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
    rotateImage() {
      this.imageRotation = (this.imageRotation + 90) % 360;
    },
  },
  computed: {
    imageTransformStyle() {
      return {
        transform: `scale(${this.imageScale}) rotate(${this.imageRotation}deg) translate(${this.imageTranslateX / this.imageScale}px, ${this.imageTranslateY / this.imageScale}px)`,
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
  touch-action: none;
  user-select: none;
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
.action-bar {
  position: fixed;
  bottom: 1em;
  left: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  height: 2.6em;
}
.action-bar-toggle {
  flex-shrink: 0;
  width: 2.6em;
  height: 2.6em;
  background: rgba(20, 20, 40, 0.45);
  backdrop-filter: blur(6px);
  border: none;
  border-top-right-radius: 0.5em;
  border-bottom-right-radius: 0.5em;
  color: #aaf;
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.action-bar-toggle:hover {
  background: rgba(40, 40, 80, 0.65);
}
.action-bar-content {
  display: flex;
  align-items: center;
  gap: 0.2em;
  height: 2.6em;
  padding: 0 0.6em;
  background: rgba(20, 20, 40, 0.45);
  backdrop-filter: blur(6px);
  border-top-right-radius: 0.5em;
  border-bottom-right-radius: 0.5em;
  overflow: hidden;
  max-width: 0;
  opacity: 0;
  transition:
    max-width 0.35s ease,
    opacity 0.25s ease;
  pointer-events: none;
}
.action-bar.expanded .action-bar-content {
  max-width: 100vw;
  opacity: 1;
  pointer-events: all;
}
.action-btn {
  background: transparent;
  border: none;
  color: #aaf;
  font-size: 0.95em;
  padding: 0.25em 0.4em;
  cursor: pointer;
  border-radius: 0.35em;
  transition:
    background 0.15s,
    color 0.15s;
  white-space: nowrap;
}
.action-btn:hover:not(:disabled) {
  background: rgba(170, 170, 255, 0.15);
  color: #fff;
}
.action-btn:disabled {
  opacity: 0.25;
  cursor: default;
}
.action-btn-danger:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.2);
  color: #f88;
}
.action-bar-divider {
  width: 1px;
  height: 1.4em;
  background: rgba(170, 170, 255, 0.2);
  margin: 0 0.2em;
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
