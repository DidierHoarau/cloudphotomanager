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
        <template
          v-if="
            authenticationStore.isAdmin || (file && getType(file) == 'image')
          "
        >
          <div class="action-bar-divider"></div>
          <div class="action-menu" ref="actionMenu">
            <button
              class="action-menu-trigger"
              @click="toggleActionsMenu"
              :disabled="isCurrentFileProcessing"
              :aria-expanded="actionsMenuOpen"
              aria-label="More actions"
              title="More actions"
            >
              <i
                class="bi"
                :class="actionsMenuOpen ? 'bi-chevron-up' : 'bi-chevron-down'"
              ></i>
            </button>
            <div v-if="actionsMenuOpen" class="action-menu-list">
              <button
                v-if="authenticationStore.isAdmin"
                class="action-menu-item"
                @click="onActionClicked('move')"
              >
                Move
              </button>
              <button
                v-if="authenticationStore.isAdmin"
                class="action-menu-item action-menu-item-danger"
                @click="onActionClicked('delete')"
              >
                Delete
              </button>
              <button
                v-if="file && getType(file) == 'image'"
                class="action-menu-item"
                @click="onActionClicked('rotate')"
              >
                Rotate
              </button>
              <button
                v-if="authenticationStore.isAdmin"
                class="action-menu-item"
                @click="onActionClicked('toggle-outtake')"
              >
                {{
                  isCurrentFileOuttake ? "Unmark as outtake" : "Mark as outtake"
                }}
              </button>
              <button
                v-if="authenticationStore.isAdmin"
                class="action-menu-item"
                @click="onActionClicked('rebuild-cache')"
              >
                Rebuild cache
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <div id="media-container" ref="mediaContainer">
      <img
        v-if="
          file &&
          getType(file) !== 'unknown' &&
          thumbnailBackdropVisible &&
          (mediaLoading || imageUnavailable || videoUnavailable)
        "
        class="media-thumb-backdrop"
        :src="getThumbnailSource(file)"
        fetchpriority="low"
        decoding="async"
        alt=""
        @error="onThumbnailBackdropError"
      />
      <Loading v-if="mediaLoading" class="media-loading" />
      <div v-if="isCurrentFileProcessing" class="processing-banner">
        <i class="bi bi-hourglass-split"></i>&nbsp; Operation in progress...
      </div>
      <template v-if="file && getType(file) == 'image'">
        <img
          class="media-content"
          v-if="!imageUnavailable"
          :src="getImageSource(file)"
          ref="zoomableImage"
          :style="imageTransformStyle"
          :class="{ 'media-hidden': mediaLoading }"
          @load="onMediaLoaded"
          @error="onImageError"
          @wheel.prevent="onImageWheel"
          @mousedown="onImageMouseDown"
          @mousemove="onImageMouseMove"
          @mouseup="onImageMouseUp"
          @mouseleave="onImageMouseUp"
        />
        <div v-else class="media-unavailable">
          <i class="bi bi-cloud-arrow-down"></i>
          <p>Image not yet available &mdash; still synchronizing</p>
        </div>
      </template>
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
        <div v-else class="media-unavailable">
          <i class="bi bi-camera-video-off"></i>
          <p>Video not yet available &mdash; still synchronizing</p>
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
import { MediaUrls } from "~~/services/MediaUrls";
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
      actionsMenuOpen: false,
      showFileInfo: false,
      file: null,
      files: [],
      position: 0,
      navigating: false,
      videoDelayedLoadingDone: false,
      videoUnavailable: false,
      imageUnavailable: false,
      thumbnailBackdropVisible: true,
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
      else if (event.key === "Escape") {
        if (this.actionsMenuOpen) {
          this.closeActionsMenu();
        } else {
          this.clickedClose();
        }
      }
    };
    this._onGlobalClick = (event) => this.onGlobalClick(event);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("click", this._onGlobalClick);

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
    window.removeEventListener("click", this._onGlobalClick);
    if (this._onOperationComplete) {
      EventBus.off(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
    }
  },
  methods: {
    toggleActionsMenu() {
      if (this.isCurrentFileProcessing) return;
      this.actionsMenuOpen = !this.actionsMenuOpen;
    },
    closeActionsMenu() {
      this.actionsMenuOpen = false;
    },
    onGlobalClick(event) {
      if (!this.actionsMenuOpen) return;
      const menuRef = this.$refs.actionMenu;
      const menuElement = Array.isArray(menuRef) ? menuRef[0] : menuRef;
      if (menuElement && !menuElement.contains(event.target)) {
        this.closeActionsMenu();
      }
    },
    clickedClose() {
      this.$emit("onFileClosed", {});
    },
    clickedMove() {
      this.activeOperation = "move";
    },
    async doActionRebuildCache() {
      if (!this.file) return;
      try {
        SyncStore().markFilesAsPending([this.file.id]);
        SyncStore().markOperationInProgress();
        await axios.post(
          `${this.serverUrl}/accounts/${this.file.accountId}/files/batch/operations/fileCacheDelete`,
          { fileIdList: [this.file.id] },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Rebuild cache queued",
        });
      } catch (err) {
        handleError(err);
      }
    },
    async doActionToggleOuttake() {
      if (!this.file) return;
      const ext = FileUtils.getExtention(this.file);
      const isOuttake = this.isCurrentFileOuttake;
      const filename = isOuttake
        ? this.file.filename.replace(`-outtake.${ext}`, `.${ext}`)
        : `${FileUtils.getWithoutExtention(this.file)}-outtake.${ext}`;
      try {
        SyncStore().markFilesAsPending([this.file.id]);
        SyncStore().markOperationInProgress();
        await axios.post(
          `${this.serverUrl}/accounts/${this.file.accountId}/files/batch/operations/fileRename`,
          {
            fileIdNames: [{ id: this.file.id, filename }],
          },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: isOuttake
            ? "File unmarked as outtake"
            : "File marked as outtake",
        });
      } catch (err) {
        handleError(err);
      }
    },
    async onActionClicked(action) {
      this.closeActionsMenu();
      if (!action) return;
      if (action === "move") {
        this.clickedMove();
        return;
      }
      if (action === "delete") {
        await this.clickedDelete();
        return;
      }
      if (action === "rotate") {
        this.rotateImage();
        return;
      }
      if (action === "toggle-outtake") {
        await this.doActionToggleOuttake();
        return;
      }
      if (action === "rebuild-cache") {
        await this.doActionRebuildCache();
      }
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
      this.imageUnavailable = false;
      this.thumbnailBackdropVisible = true;
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
      return MediaUrls.imagePreviewFromBase(this.staticUrl, file);
    },
    getVideoSource(file) {
      return MediaUrls.videoPreviewFromBase(this.staticUrl, file);
    },
    getThumbnailSource(file) {
      return MediaUrls.thumbnailFromBase(this.staticUrl, file);
    },
    onMediaLoaded() {
      this.mediaLoading = false;
    },
    onImageError() {
      this.imageUnavailable = true;
      this.mediaLoading = false;
    },
    onVideoError() {
      this.videoUnavailable = true;
      this.mediaLoading = false;
    },
    onThumbnailBackdropError() {
      this.thumbnailBackdropVisible = false;
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
    isCurrentFileOuttake() {
      if (!this.file || !this.file.filename) return false;
      const ext = FileUtils.getExtention(this.file);
      return this.file.filename.includes(`-outtake.${ext}`);
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
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  width: 100vw;
  height: 100vh;
  position: relative;
  touch-action: none;
  user-select: none;
}
#media-container .media-content {
  grid-column: 1;
  grid-row: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.action-bar {
  position: fixed;
  bottom: 1em;
  left: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
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
.action-menu {
  position: relative;
}
.action-menu-trigger {
  width: 2.2em;
  height: 2.2em;
  background: transparent;
  border: 1px solid rgba(170, 170, 255, 0.25);
  border-radius: 0.35em;
  color: #aaf;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.05em;
}
.action-menu-trigger:hover:not(:disabled) {
  background: rgba(170, 170, 255, 0.15);
}
.action-menu-trigger:disabled {
  opacity: 0.25;
  cursor: default;
}
.action-menu-list {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.4em);
  min-width: 12em;
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  padding: 0.35em;
  border-radius: 0.4em;
  border: 1px solid rgba(170, 170, 255, 0.25);
  background: rgba(20, 20, 40, 0.95);
  backdrop-filter: blur(6px);
  box-shadow: 0 0.3em 1.2em rgba(0, 0, 0, 0.35);
}
.action-menu-item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 0.3em;
  color: #aaf;
  font-size: 0.85em;
  padding: 0.35em 0.45em;
  cursor: pointer;
}
.action-menu-item:hover {
  background: rgba(170, 170, 255, 0.15);
  color: #fff;
}
.action-menu-item-danger:hover {
  background: rgba(255, 80, 80, 0.2);
  color: #f88;
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
.media-content {
  position: relative;
  z-index: 2;
}
.media-unavailable {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75em;
  color: #aaf;
  opacity: 0.75;
  font-size: 1.1em;
  text-align: center;
  padding: 1em;
  position: relative;
  z-index: 2;
}
.media-unavailable i {
  font-size: 3em;
}
.media-unavailable p {
  margin: 0;
}
.media-thumb-backdrop {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  object-fit: cover;
  object-position: center;
  filter: blur(18px) brightness(0.65);
  opacity: 0.6;
  z-index: 1;
  pointer-events: none;
  user-select: none;
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
