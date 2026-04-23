<template>
  <div class="file-preview">
    <DialogMove
      v-if="activeOperation == 'move'"
      :files="[file]"
      @onDone="onOperationDone"
    />
    <DialogFileInfo
      v-if="showFileInfo && file"
      :key="file.id"
      :file="file"
      @onClose="showFileInfo = false"
      @onDuplicateDeleted="onDuplicateDeleted"
    />
    <DialogConfirm
      v-if="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @onConfirm="onConfirmDialog"
      @onCancel="showConfirmDialog = false"
    />
    <div class="action-bar">
      <div class="action-bar-main">
        <button
          class="action-btn"
          @click="previousMedia()"
          :disabled="!hasPreviousSupported"
          title="Previous"
        >
          <i class="bi bi-arrow-left"></i>
        </button>
        <button
          class="action-btn"
          @click="nextMedia()"
          :disabled="!hasNextSupported"
          title="Next"
        >
          <i class="bi bi-arrow-right"></i>
        </button>
        <div class="action-bar-divider"></div>
        <label class="action-checkbox" title="Select">
          <input
            type="checkbox"
            :checked="isFileSelected"
            @change="toggleSelection()"
          />
        </label>
        <div class="action-bar-divider"></div>
        <button class="action-btn" @click="showFileInfo = true" title="Info">
          <i class="bi bi-info-circle"></i>
        </button>
        <button class="action-btn" @click="clickedClose()" title="Close">
          <i class="bi bi-x-lg"></i>
        </button>
        <button
          class="action-bar-toggle"
          @click="actionBarExpanded = !actionBarExpanded"
        >
          <i
            :class="
              actionBarExpanded ? 'bi bi-chevron-down' : 'bi bi-chevron-up'
            "
          ></i>
        </button>
      </div>
      <div class="action-bar-extra" :class="{ expanded: actionBarExpanded }">
        <button
          class="action-btn"
          v-if="file && getType(file) == 'image'"
          @click="rotateImage()"
          title="Rotate"
        >
          <i class="bi bi-arrow-clockwise"></i>
        </button>
        <template v-if="authenticationStore.isAdmin">
          <div class="action-bar-divider"></div>
          <button
            class="action-btn"
            @click="clickedMove()"
            title="Move"
            :disabled="isCurrentFileProcessing"
          >
            <i class="bi bi-arrows-move"></i>
          </button>
          <button
            class="action-btn action-btn-danger"
            @click="clickedDelete()"
            title="Delete"
            :disabled="isCurrentFileProcessing"
          >
            <i class="bi bi-trash-fill"></i>
          </button>
        </template>
      </div>
    </div>
    <div id="media-container" ref="mediaContainer">
      <Loading v-if="mediaLoading" class="media-loading" />
      <div v-if="isCurrentFileProcessing" class="processing-banner">
        <i class="bi bi-hourglass-split"></i>&nbsp; Operation in progress...
      </div>
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
const syncStore = SyncStore();
</script>

<script>
import axios from "axios";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { FileUtils } from "~~/services/FileUtils";
import * as Hammer from "hammerjs";
import { findIndex } from "lodash";

export default {
  props: {
    galleryFiles: {
      type: Array,
      required: true,
    },
    initialPosition: {
      type: Number,
      default: 0,
    },
    selectedFiles: {
      type: Array,
      required: false,
      default: () => [],
    },
  },
  data() {
    return {
      serverUrl: "",
      staticUrl: "",
      activeOperation: "",
      actionBarExpanded: false,
      showFileInfo: false,
      file: null,
      files: [],
      position: 0,
      navigating: false,
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
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
    };
  },
  watch: {
    galleryFiles(newFiles) {
      if (newFiles === this.files) return;
      if (!newFiles || newFiles.length === 0) {
        this.clickedClose();
        return;
      }
      const currentId = this.file?.id;
      this.files = newFiles;
      if (!currentId) {
        this.position = Math.min(this.position, newFiles.length - 1);
        // Only reload if not already showing the right file
        this.loadMedia();
        return;
      }
      const newIndex = newFiles.findIndex((f) => f.id === currentId);
      if (newIndex >= 0) {
        // Current file still exists — just keep position in sync, no reload
        this.position = newIndex;
      } else {
        // Current file was removed externally (e.g. parent re-fetched)
        // Don't double-advance if removeFileAndAdvance already ran
        if (!this._removedByOperation) {
          this.position = Math.min(this.position, newFiles.length - 1);
          this.loadMedia();
        }
        this._removedByOperation = false;
      }
    },
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this.staticUrl = (await Config.get()).STATIC_URL;

    this.files = this.galleryFiles;
    this.position = this.initialPosition;
    this.loadMedia(true);

    this._onKeyDown = (event) => {
      if (event.key === "ArrowRight") this.nextMedia();
      else if (event.key === "ArrowLeft") this.previousMedia();
      else if (event.key === "Escape") this.clickedClose();
    };
    window.addEventListener("keydown", this._onKeyDown);

    this._onOperationComplete = (message) => {
      if (!this.file) return;
      const operationName = message?.operationName || "";
      const affectedFileIds = message?.fileIds || [];
      // fileDelete: only act if the current file was NOT already removed
      // optimistically (removeFileAndAdvance sets _removedByOperation)
      if (
        operationName === "fileDelete" &&
        affectedFileIds.includes(this.file.id)
      ) {
        this._removedByOperation = true;
        this.removeFileAndAdvance(affectedFileIds);
      }
    };
    EventBus.on(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
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
    if (this._onOperationComplete) {
      EventBus.off(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
    }
  },
  methods: {
    clickedClose() {
      this.$emit("onFileClosed", {});
    },
    clickedMove() {
      this.activeOperation = "move";
    },
    onDuplicateDeleted(fileId) {
      // If the deleted duplicate is in our files list, remove it
      this.files = this.files.filter((f) => f.id !== fileId);
    },
    getType(file) {
      return FileUtils.getType(file);
    },
    removeFileAndAdvance(fileIds) {
      const removeSet = new Set(fileIds);
      const removeIndex = this.files.findIndex((f) => removeSet.has(f.id));
      this.files = this.files.filter((f) => !removeSet.has(f.id));
      this._removedByOperation = true;
      if (this.files.length === 0) {
        this.clickedClose();
      } else {
        this.position = Math.min(
          removeIndex >= 0 ? removeIndex : this.position,
          this.files.length - 1,
        );
        this.loadMedia();
      }
    },
    async clickedDelete() {
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = `Delete the file? (Can't be undone!)\nFile: ${this.file.filename} \n`;
      this.confirmDialogCallback = async () => {
        const fileId = this.file.id;
        const accountId = this.file.accountId;
        try {
          await axios.post(
            `${this.serverUrl}/accounts/${accountId}/files/batch/operations/fileDelete`,
            { fileIdList: [fileId] },
            await AuthService.getAuthHeader(),
          );
          SyncStore().markFilesAsPending([fileId]);
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            text: "Delete queued \u2014 running in background",
          });
          // Advance immediately (optimistic). Mark so the galleryFiles watcher
          // and the OPERATION_COMPLETE listener don't double-advance.
          this._removedByOperation = true;
          this.removeFileAndAdvance([fileId]);
        } catch (err) {
          handleError(err);
        }
      };
      this.showConfirmDialog = true;
    },
    onConfirmDialog() {
      this.showConfirmDialog = false;
      if (this.confirmDialogCallback) {
        this.confirmDialogCallback();
      }
    },
    onOperationDone() {
      this.activeOperation = "";
      if (this.file) {
        // Mark so the galleryFiles watcher doesn't double-advance
        this._removedByOperation = true;
        this.removeFileAndAdvance([this.file.id]);
      }
    },
    navigateMedia(direction) {
      if (this.navigating) return;
      const isPrevious = direction === "previous";
      if (this.files.length === 0) return;
      if (isPrevious && this.position === 0) return;
      if (!isPrevious && this.position === this.files.length - 1) return;
      const step = isPrevious ? -1 : 1;
      let newPos = this.position + step;
      while (
        newPos >= 0 &&
        newPos < this.files.length &&
        this.getType(this.files[newPos]) === "unknown"
      ) {
        newPos += step;
      }
      if (newPos < 0 || newPos >= this.files.length) return;
      const mediaDomElement =
        this.$refs.mediaContainer?.querySelector(".media-content");
      if (!mediaDomElement) {
        // No animation possible, navigate immediately
        this.position = newPos;
        this.loadMedia();
        return;
      }
      this.navigating = true;
      const outClass = isPrevious
        ? "animate-media-out-right"
        : "animate-media-out-left";
      const inClass = isPrevious
        ? "animate-media-in-left"
        : "animate-media-in-right";
      mediaDomElement.classList.add(outClass);
      setTimeout(() => {
        this.position = newPos;
        this.loadMedia();
        mediaDomElement.classList.remove(outClass);
        mediaDomElement.classList.add(inClass);
      }, 300);
      setTimeout(() => {
        mediaDomElement.classList.remove("animate-media-in-left");
        mediaDomElement.classList.remove("animate-media-in-right");
        this.navigating = false;
      }, 700);
    },
    previousMedia() {
      this.navigateMedia("previous");
    },
    nextMedia() {
      this.navigateMedia("next");
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
      const currentQuery = useRoute().query;
      if (newRoute) {
        useRouter().push({
          query: {
            ...currentQuery,
            fileId: this.file.id,
          },
        });
      } else {
        useRouter().replace({
          query: {
            ...currentQuery,
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
    toggleSelection() {
      if (this.file) {
        this.$emit("onFileSelected", this.file);
      }
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
    isCurrentFileProcessing() {
      if (!this.file) return false;
      return SyncStore().isFileProcessing(this.file.id);
    },
    hasPreviousSupported() {
      for (let i = this.position - 1; i >= 0; i--) {
        if (this.getType(this.files[i]) !== "unknown") return true;
      }
      return false;
    },
    hasNextSupported() {
      for (let i = this.position + 1; i < this.files.length; i++) {
        if (this.getType(this.files[i]) !== "unknown") return true;
      }
      return false;
    },
    isFileSelected() {
      if (!this.file) return false;
      return findIndex(this.selectedFiles, { id: this.file.id }) >= 0;
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
  flex-direction: column-reverse;
  align-items: flex-start;
  gap: 0.3em;
}
.action-bar-main {
  display: flex;
  align-items: center;
  gap: 0.2em;
  height: 2.6em;
  padding: 0 0.6em;
  background: rgba(20, 20, 40, 0.45);
  backdrop-filter: blur(6px);
  border-top-right-radius: 0.5em;
  border-bottom-right-radius: 0.5em;
}
.action-bar-extra {
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
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease,
    padding 0.3s ease;
  pointer-events: none;
}
.action-bar-extra.expanded {
  max-height: 3em;
  padding-top: 0;
  padding-bottom: 0;
  height: 2.6em;
  opacity: 1;
  pointer-events: all;
}
.action-bar-toggle {
  flex-shrink: 0;
  width: 2.2em;
  height: 2.2em;
  background: transparent;
  border: none;
  color: #aaf;
  font-size: 0.75em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.35em;
  transition: background 0.2s;
  margin-left: 0.2em;
}
.action-bar-toggle:hover {
  background: rgba(170, 170, 255, 0.15);
}
.action-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0.25em 0.3em;
}
.action-checkbox input[type="checkbox"] {
  width: 1.1em;
  height: 1.1em;
  cursor: pointer;
  accent-color: #aaf;
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
.processing-banner {
  position: fixed;
  top: 1em;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 20, 40, 0.75);
  backdrop-filter: blur(6px);
  color: #aaf;
  padding: 0.4em 1.2em;
  border-radius: 2em;
  font-size: 0.9em;
  z-index: 300;
  pointer-events: none;
}
</style>
