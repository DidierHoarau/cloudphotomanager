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
    <DialogFileMetadata
      v-if="showFileMetadata && file"
      :key="`meta-${file.id}`"
      :file="file"
      @onClose="showFileMetadata = false"
    />
    <DialogConfirm
      v-if="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @onConfirm="onConfirmDialog"
      @onCancel="showConfirmDialog = false"
    />
    <DialogAddToAlbum
      v-if="showAddToAlbum && file"
      :files="[file]"
      @onDone="showAddToAlbum = false"
    />
    <DialogShareActions
      v-if="showShareActions && file"
      :accountId="file.accountId"
      scope="file"
      :scopeId="file.id"
      :targetName="file.filename || ''"
      @onDone="showShareActions = false"
    />
    <div v-if="file" class="media-overlay">
      <div class="media-overlay-meta">
        <span v-if="captureDate" class="media-overlay-date">
          {{ captureDate }}
        </span>
        <span v-if="placeLabel" class="media-overlay-place">
          <i class="bi bi-geo-alt"></i> {{ placeLabel }}
        </span>
        <span v-if="file.favorite" class="media-overlay-favorite" title="Favorite">
          <i class="bi bi-star-fill"></i>
          <span class="visually-hidden">Favorite</span>
        </span>
      </div>
      <a
        v-if="canDownloadOriginal"
        class="media-overlay-download"
        :href="downloadOriginalHref()"
        :download="file.filename"
        aria-label="Download original"
        title="Download original"
      >
        <i class="bi bi-download"></i>
        <span class="visually-hidden">Download original</span>
      </a>
    </div>
    <span class="visually-hidden" aria-live="polite">{{ mediaAnnouncement }}</span>
    <div class="action-bar">
      <div v-if="slideshowActive" class="action-bar-main slideshow-controls">
        <select
          v-model.number="slideshowInterval"
          class="slideshow-interval"
          aria-label="Slideshow interval"
          @change="onSlideshowIntervalChange()"
        >
          <option
            v-for="seconds in slideshowIntervals"
            :key="seconds"
            :value="seconds"
          >
            {{ seconds }} s
          </option>
        </select>
        <button
          type="button"
          class="action-btn"
          :class="{ 'slideshow-toggle-active': slideshowLoop }"
          :aria-pressed="slideshowLoop"
          @click="toggleSlideshowLoop()"
        >
          <i class="bi bi-arrow-repeat"></i> Loop
        </button>
        <button
          type="button"
          class="action-btn"
          :class="{ 'slideshow-toggle-active': slideshowShuffle }"
          :aria-pressed="slideshowShuffle"
          @click="toggleSlideshowShuffle()"
        >
          <i class="bi bi-shuffle"></i> Shuffle
        </button>
        <button
          v-if="fullscreenSupported"
          type="button"
          class="action-btn"
          :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
          :title="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
          @click="toggleFullscreen()"
        >
          <i
            class="bi"
            :class="fullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'"
          ></i>
        </button>
        <span class="slideshow-status" aria-live="off">
          {{ slideshowPlaying ? "Playing" : "Paused" }}
        </span>
      </div>
      <div class="action-bar-main">
        <button
          class="action-btn"
          @click="previousMedia()"
          :disabled="!hasPreviousSupported"
          aria-label="Previous photo"
          title="Previous"
        >
          <i class="bi bi-arrow-left"></i>
        </button>
        <button
          class="action-btn"
          @click="nextMedia()"
          :disabled="!hasNextSupported"
          aria-label="Next photo"
          title="Next"
        >
          <i class="bi bi-arrow-right"></i>
        </button>
        <button
          class="action-btn"
          @click="toggleSlideshowPlay()"
          :disabled="!hasSlideshowFiles"
          :aria-label="slideshowPlaying ? 'Pause slideshow' : 'Play slideshow'"
          :title="slideshowPlaying ? 'Pause slideshow' : 'Play slideshow'"
        >
          <i
            class="bi"
            :class="slideshowPlaying ? 'bi-pause-fill' : 'bi-play-fill'"
          ></i>
        </button>
        <div class="action-bar-divider"></div>
        <label class="action-checkbox" title="Select" aria-label="Select photo">
          <input
            type="checkbox"
            :checked="isFileSelected"
            aria-label="Select photo"
            @change="toggleSelection()"
          />
        </label>
        <div class="action-bar-divider"></div>
        <a
          v-if="canDownloadOriginal"
          class="action-btn"
          :href="downloadOriginalHref()"
          :download="file && file.filename"
          aria-label="Download"
          title="Download"
        >
          <i class="bi bi-download"></i>
        </a>
        <a
          v-if="canDownloadOriginal"
          class="action-btn"
          :href="downloadOriginalHref('inline')"
          target="_blank"
          rel="noopener"
          aria-label="Open original"
          title="Open original"
        >
          <i class="bi bi-box-arrow-up-right"></i>
        </a>
        <button
          v-if="authenticationStore.isAdmin && !shareToken"
          class="action-btn"
          @click="doActionToggleFavorite()"
          :aria-label="
            file && file.favorite ? 'Remove favorite' : 'Add favorite'
          "
          :title="file && file.favorite ? 'Remove favorite' : 'Add favorite'"
        >
          <i
            class="bi"
            :class="file && file.favorite ? 'bi-star-fill' : 'bi-star'"
          ></i>
        </button>
        <button
          v-if="!shareToken"
          class="action-btn"
          @click="showFileInfo = true"
          aria-label="Info"
          title="Info"
        >
          <i class="bi bi-info-circle"></i>
        </button>
        <NuxtLink
          v-if="mapLink"
          class="action-btn"
          :to="mapLink"
          aria-label="Show on map"
          title="Show on map"
        >
          <i class="bi bi-geo-alt"></i>
        </NuxtLink>
        <button
          class="action-btn"
          @click="clickedClose()"
          aria-label="Close"
          title="Close"
        >
          <i class="bi bi-x-lg"></i>
        </button>
        <template v-if="authenticationStore.isAdmin || (file && isImage(file))">
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
                :class="actionsMenuOpen ? 'bi-chevron-down' : 'bi-chevron-up'"
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
                v-if="!shareToken && authenticationStore.isAuthenticated"
                class="action-menu-item"
                @click="onActionClicked('add-to-album')"
              >
                Add to album
              </button>
              <button
                v-if="!shareToken && authenticationStore.isAdmin"
                class="action-menu-item"
                @click="onActionClicked('share-file')"
              >
                Share file link
              </button>
              <button
                v-if="authenticationStore.isAdmin"
                class="action-menu-item action-menu-item-danger"
                @click="onActionClicked('delete')"
              >
                Move to Trash
              </button>
              <button
                v-if="file && isImage(file)"
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
              <button
                class="action-menu-item"
                @click="onActionClicked('metadata')"
              >
                Show metadata
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
      <template v-if="file && isImage(file)">
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
          <i :class="unavailableIcon('bi bi-cloud-arrow-down')"></i>
          <p>{{ imageUnavailableText }}</p>
        </div>
      </template>
      <template
        v-if="file && videoDelayedLoadingDone && getType(file) == 'video'"
      >
        <video
          class="media-content"
          v-if="!videoUnavailable"
          ref="videoElement"
          controls
          muted
          playsinline
          :class="{ 'media-hidden': mediaLoading }"
          @loadeddata="onMediaLoaded"
          @playing="onVideoPlaying"
          @ended="onVideoEnded"
          @error="onVideoError"
        >
          <source
            :src="getVideoSource(file)"
            type="video/mp4"
            @error="onVideoError"
          />
        </video>
        <div v-else class="media-unavailable">
          <i :class="unavailableIcon('bi bi-camera-video-off')"></i>
          <p>{{ videoUnavailableText }}</p>
        </div>
      </template>
    </div>
    <div id="media-preload">
      <img
        v-if="position > 0 && isImage(files[position - 1])"
        :src="getImageSource(files[position - 1])"
      />
      <img
        v-if="position + 1 < files.length && isImage(files[position + 1])"
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
import { GeoUtils } from "~~/services/GeoUtils";
import { PreferencesSlideshow } from "~~/services/PreferencesSlideshow";
import {
  buildSlideshowOrder,
  nextSlideshowPosition,
  previousSlideshowPosition,
  SLIDESHOW_INTERVALS,
} from "~~/utils/Slideshow";
import { formatCaptureDate, formatPlace } from "~~/utils/MediaInfo";
import { isSyncBlocked, isSyncGone } from "~~/utils/SyncHealth";
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
    // Starts in slideshow mode (auto-advance, video autoplay, wake lock).
    slideshow: {
      type: Boolean,
      default: false,
    },
    // When set, the viewer runs on the public share page: downloads go
    // through the token-based share endpoint instead of the session-cookie
    // one, and dialogs that need a user session are hidden.
    shareToken: {
      type: String,
      required: false,
      default: "",
    },
  },
  data() {
    return {
      serverUrl: "",
      activeOperation: "",
      actionsMenuOpen: false,
      showFileInfo: false,
      showFileMetadata: false,
      showAddToAlbum: false,
      showShareActions: false,
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
      slideshowIntervals: SLIDESHOW_INTERVALS,
      slideshowActive: false,
      slideshowPlaying: false,
      slideshowInterval: 5,
      slideshowLoop: true,
      slideshowShuffle: false,
      slideshowOrder: [],
      fullscreen: false,
      prefersReducedMotion: false,
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

    const slideshowOptions = PreferencesSlideshow.getOptions();
    this.slideshowInterval = slideshowOptions.interval;
    this.slideshowLoop = slideshowOptions.loop;
    this.slideshowShuffle = slideshowOptions.shuffle;

    if (typeof window !== "undefined" && window.matchMedia) {
      this._reducedMotionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      this.prefersReducedMotion = this._reducedMotionQuery.matches;
      this._onReducedMotionChange = (event) => {
        this.prefersReducedMotion = event.matches;
      };
      if (this._reducedMotionQuery.addEventListener) {
        this._reducedMotionQuery.addEventListener(
          "change",
          this._onReducedMotionChange,
        );
      }
    }

    this.files = this.galleryFiles;
    this.position = this.initialPosition;
    this.loadMedia(true);

    this._onKeyDown = (event) => {
      const target = event.target;
      const tagName = target?.tagName ? target.tagName.toLowerCase() : "";
      const isContentEditable = !!target?.isContentEditable;
      const isTextEntry =
        tagName === "textarea" ||
        tagName === "select" ||
        isContentEditable ||
        (tagName === "input" &&
          ![
            "checkbox",
            "radio",
            "button",
            "submit",
            "reset",
            "file",
            "range",
            "color",
          ].includes(target.type || "text"));
      // Space and F keep their native meaning on form controls; arrows keep
      // working after clicking an action button.
      const isFormControl =
        isTextEntry ||
        tagName === "button" ||
        tagName === "a" ||
        tagName === "input";
      if (event.key === "ArrowRight" && !isTextEntry) {
        event.preventDefault();
        this.nextMedia();
      } else if (event.key === "ArrowLeft" && !isTextEntry) {
        event.preventDefault();
        this.previousMedia();
      } else if (
        (event.key === " " || event.key === "Spacebar") &&
        !isFormControl
      ) {
        event.preventDefault();
        this.toggleSlideshowPlay();
      } else if (
        (event.key === "f" || event.key === "F") &&
        !isFormControl
      ) {
        event.preventDefault();
        this.toggleFullscreen();
      } else if (event.key === "Escape") {
        if (this.actionsMenuOpen) {
          this.closeActionsMenu();
        } else {
          this.clickedClose();
        }
      }
    };
    this._onGlobalClick = (event) => this.onGlobalClick(event);
    this._onFullscreenChange = () => {
      this.fullscreen = !!(
        typeof document !== "undefined" && document.fullscreenElement
      );
    };
    this._onVisibilityChange = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        this.slideshowPlaying
      ) {
        this.requestWakeLock();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("click", this._onGlobalClick);
    document.addEventListener("fullscreenchange", this._onFullscreenChange);
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    this._onOperationComplete = (message) => {
      if (!this.file) return;
      const operationName = message?.operationName || "";
      const affectedFileIds = message?.fileIds || [];
      // fileDelete/fileTrash: only act if the current file was NOT already
      // removed optimistically (removeFileAndAdvance sets _removedByOperation)
      if (
        (operationName === "fileDelete" || operationName === "fileTrash") &&
        affectedFileIds.includes(this.file.id)
      ) {
        this._removedByOperation = true;
        this.removeFileAndAdvance(affectedFileIds);
      }
    };
    EventBus.on(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
  },
  async mounted() {
    if (this.slideshow) {
      this.startSlideshow();
    }
    const mediaContainer = this.$refs.mediaContainer;
    if (!mediaContainer) return;
    // Dynamic import: hammerjs (~20 KB) is only needed when the viewer is open
    const Hammer = await import("hammerjs");
    // The viewer may be closed while the dynamic import is in flight: do not
    // attach a manager to a torn-down element.
    if (this._isUnmounted) return;
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
    this._gestureManager = gestureManager;
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
    this._isUnmounted = true;
    this.pauseSlideshow();
    this._preloadedImages = [];
    if (this._gestureManager) {
      this._gestureManager.destroy();
      this._gestureManager = null;
    }
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("click", this._onGlobalClick);
    document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    if (
      this._reducedMotionQuery &&
      this._reducedMotionQuery.removeEventListener
    ) {
      this._reducedMotionQuery.removeEventListener(
        "change",
        this._onReducedMotionChange,
      );
    }
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
      this.pauseSlideshow();
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
    async doActionToggleFavorite() {
      if (!this.file) return;
      const favorite = !this.file.favorite;
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${this.file.accountId}/files/batch/operations/fileFavorite`,
          { fileIdList: [this.file.id], favorite },
          await AuthService.getAuthHeader(),
        );
        // The file object is shared with the grid: the badge updates too.
        this.file.favorite = favorite ? 1 : 0;
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: favorite ? "Added to favorites" : "Removed from favorites",
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
      if (action === "add-to-album") {
        this.showAddToAlbum = true;
        return;
      }
      if (action === "share-file") {
        this.showShareActions = true;
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
      if (action === "metadata") {
        this.showFileMetadata = true;
      }
    },
    onDuplicateDeleted(fileId) {
      // If the deleted duplicate is in our files list, remove it
      this.files = this.files.filter((f) => f.id !== fileId);
    },
    getType(file) {
      return FileUtils.getType(file);
    },
    isImage(file) {
      return FileUtils.isImage(file);
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
      this.confirmDialogTitle = "Move to Trash";
      this.confirmDialogMessage = `Move the file to Trash? (Restorable for 30 days)\nFile: ${this.file.filename} \n`;
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
            text: "Moved to Trash",
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
      this.navigateToPosition(newPos, isPrevious);
    },
    navigateToPosition(newPos, isPrevious) {
      if (this.navigating) return;
      if (newPos < 0 || newPos >= this.files.length) return;
      if (this.getType(this.files[newPos]) === "unknown") return;
      const mediaDomElement =
        this.$refs.mediaContainer?.querySelector(".media-content");
      // Reduced-motion users swap media without the slide animation, both for
      // manual navigation and for automatic slideshow advances.
      if (!mediaDomElement || this.prefersReducedMotion) {
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
    hasPlayableFile(file) {
      return (
        !!file &&
        !FileUtils.isOuttake(file) &&
        this.getType(file) !== "unknown"
      );
    },
    startSlideshow() {
      const order = buildSlideshowOrder(this.files, this.slideshowShuffle);
      if (order.length === 0) {
        return;
      }
      this.slideshowOrder = order;
      this.slideshowActive = true;
      if (!order.includes(this.position)) {
        this.position = order[0];
        this.loadMedia();
      }
      this.slideshowPlaying = true;
      this.requestWakeLock();
      if (!this.mediaLoading) {
        this.scheduleSlideshowTick();
      }
      this.preloadSlideshowNeighbors();
      this.$nextTick(() => this.tryAutoplayVideo());
    },
    pauseSlideshow() {
      this.slideshowPlaying = false;
      this.clearSlideshowTimer();
      this.releaseWakeLock();
    },
    toggleSlideshowPlay() {
      if (this.slideshowPlaying) {
        this.pauseSlideshow();
        return;
      }
      if (!this.slideshowActive || this.slideshowOrder.length === 0) {
        this.startSlideshow();
        return;
      }
      this.slideshowPlaying = true;
      this.requestWakeLock();
      if (!this.mediaLoading) {
        this.scheduleSlideshowTick();
      }
      this.$nextTick(() => this.tryAutoplayVideo());
    },
    clearSlideshowTimer() {
      if (this._slideshowTimer) {
        clearTimeout(this._slideshowTimer);
        this._slideshowTimer = null;
      }
    },
    scheduleSlideshowTick() {
      this.clearSlideshowTimer();
      if (!this.slideshowPlaying) return;
      // Videos advance on their `ended` event, not on a timer.
      if (this.file && this.getType(this.file) === "video") return;
      this._slideshowTimer = setTimeout(
        () => {
          this._slideshowTimer = null;
          this.slideshowAdvance();
        },
        Math.max(1, this.slideshowInterval) * 1000,
      );
    },
    slideshowAdvance() {
      if (!this.slideshowPlaying) return;
      if (this.navigating) {
        // Do not drop an advance that fires while the previous one animates.
        this.clearSlideshowTimer();
        this._slideshowTimer = setTimeout(() => {
          this._slideshowTimer = null;
          this.slideshowAdvance();
        }, 150);
        return;
      }
      const next = nextSlideshowPosition(
        this.slideshowOrder,
        this.position,
        this.slideshowLoop,
      );
      if (next === null) {
        this.pauseSlideshow();
        return;
      }
      this.navigateToPosition(next, next < this.position);
    },
    persistSlideshowPreferences() {
      PreferencesSlideshow.setOptions({
        interval: this.slideshowInterval,
        loop: this.slideshowLoop,
        shuffle: this.slideshowShuffle,
      });
    },
    onSlideshowIntervalChange() {
      this.persistSlideshowPreferences();
      if (this.slideshowPlaying) {
        this.scheduleSlideshowTick();
      }
    },
    toggleSlideshowLoop() {
      this.slideshowLoop = !this.slideshowLoop;
      this.persistSlideshowPreferences();
    },
    toggleSlideshowShuffle() {
      this.slideshowShuffle = !this.slideshowShuffle;
      this.persistSlideshowPreferences();
      if (this.slideshowActive) {
        this.slideshowOrder = buildSlideshowOrder(
          this.files,
          this.slideshowShuffle,
        );
      }
    },
    preloadSlideshowNeighbors() {
      if (!this.slideshowPlaying || this.slideshowOrder.length === 0) {
        return;
      }
      if (!this._preloadedImages) {
        this._preloadedImages = [];
      }
      const positions = [];
      const next = nextSlideshowPosition(
        this.slideshowOrder,
        this.position,
        this.slideshowLoop,
      );
      if (next !== null) {
        positions.push(next);
      }
      if (this.slideshowLoop && this.slideshowOrder.length > 1) {
        positions.push(this.slideshowOrder[0]);
      }
      for (const position of positions) {
        const file = this.files[position];
        if (!file || !this.isImage(file)) {
          continue;
        }
        const image = new Image();
        image.src = this.getImageSource(file);
        this._preloadedImages.push(image);
      }
      // Keep only the most recent preloads: a long slideshow must not retain
      // every decoded image in memory.
      if (this._preloadedImages.length > 6) {
        this._preloadedImages.splice(0, this._preloadedImages.length - 6);
      }
    },
    async tryAutoplayVideo() {
      if (!this.slideshowPlaying || !this.file) {
        return;
      }
      if (this.getType(this.file) !== "video") {
        return;
      }
      const video = this.$refs.videoElement;
      if (!video) {
        return;
      }
      try {
        await video.play();
      } catch (err) {
        // Autoplay refused: keep the controls usable and stop advancing.
        this.pauseSlideshow();
      }
    },
    onVideoPlaying() {
      this.mediaLoading = false;
      this.preloadSlideshowNeighbors();
    },
    onVideoEnded() {
      if (this.slideshowPlaying) {
        this.slideshowAdvance();
      }
    },
    toggleFullscreen() {
      if (
        typeof document === "undefined" ||
        !document.documentElement.requestFullscreen
      ) {
        return;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen?.()?.catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    },
    requestWakeLock() {
      if (
        typeof navigator === "undefined" ||
        !navigator.wakeLock ||
        this._wakeLock
      ) {
        return;
      }
      try {
        navigator.wakeLock
          .request("screen")
          .then((lock) => {
            this._wakeLock = lock;
            if (lock && lock.addEventListener) {
              lock.addEventListener("release", () => {
                this._wakeLock = null;
              });
            }
          })
          .catch(() => {
            this._wakeLock = null;
          });
      } catch (err) {
        this._wakeLock = null;
      }
    },
    releaseWakeLock() {
      const lock = this._wakeLock;
      this._wakeLock = null;
      if (!lock || !lock.release) {
        return;
      }
      try {
        lock.release().catch(() => {});
      } catch (err) {
        /* ignore */
      }
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
        // In-viewer navigation: keep the URL accurate without creating a
        // history entry per photo or triggering the gallery route watchers.
        const url = new URL(window.location.href);
        url.searchParams.set("fileId", this.file.id);
        window.history.replaceState(window.history.state, "", url);
      }
      setTimeout(() => {
        this.videoDelayedLoadingDone = true;
        this.tryAutoplayVideo();
      }, 100);
      this.preloadSlideshowNeighbors();
    },
    preloadFile(file) {
      const img = new Image();
      img.src = this.getImageSource(file);
    },
    getImageSource(file) {
      return MediaUrls.imagePreview(file);
    },
    getVideoSource(file) {
      return MediaUrls.videoPreview(file);
    },
    getThumbnailSource(file) {
      return MediaUrls.thumbnail(file);
    },
    downloadOriginalHref(disposition) {
      if (this.shareToken) {
        return `${this.serverUrl}/share/${encodeURIComponent(this.shareToken)}/files/${encodeURIComponent(this.file.id)}/download${disposition === "inline" ? "?disposition=inline" : ""}`;
      }
      return `${this.serverUrl}/files/${encodeURIComponent(this.file.id)}/download${disposition === "inline" ? "?disposition=inline" : ""}`;
    },
    onMediaLoaded() {
      this.mediaLoading = false;
      this.preloadSlideshowNeighbors();
      this.scheduleSlideshowTick();
    },
    unavailableIcon(syncingIcon) {
      if (this.fileIsSyncGone) {
        return "bi bi-cloud-slash";
      }
      if (this.fileIsSyncBlocked) {
        return "bi bi-file-earmark-x";
      }
      return syncingIcon;
    },
    onImageError() {
      this.imageUnavailable = true;
      this.mediaLoading = false;
      this.scheduleSlideshowTick();
    },
    onVideoError() {
      this.videoUnavailable = true;
      this.mediaLoading = false;
      this.scheduleSlideshowTick();
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
    canDownloadOriginal() {
      if (!this.file) return false;
      if (this.shareToken) return true;
      const capabilities = AccountsStore().capabilitiesFor(
        this.file.accountId,
      );
      return !!(capabilities && capabilities.downloadFileOriginal);
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
    // Map deep link for the current file; hidden on the share page. Navigating
    // to the map unmounts the viewer; browser Back restores it via the
    // existing fileId query handling.
    mapLink() {
      if (!this.file || this.shareToken) return null;
      const coords = GeoUtils.getGpsCoords(this.file);
      if (!coords) return null;
      return {
        path: "/search/map",
        query: {
          accountId: this.file.accountId,
          lat: coords.lat,
          lon: coords.lon,
          zoom: 16,
        },
      };
    },
    isCurrentFileOuttake() {
      return FileUtils.isOuttake(this.file);
    },
    // A file stuck at the retry cap (or tombstoned as missing in the cloud)
    // will never produce a preview by itself: say so instead of claiming the
    // media is "still synchronizing".
    fileIsSyncBlocked() {
      return isSyncBlocked(this.file);
    },
    fileIsSyncGone() {
      return isSyncGone(this.file);
    },
    imageUnavailableText() {
      if (this.fileIsSyncGone) {
        return "Image unavailable — missing in cloud";
      }
      if (this.fileIsSyncBlocked) {
        return "Preview unavailable — the file may be unsupported or corrupt";
      }
      return "Image not yet available — still synchronizing";
    },
    videoUnavailableText() {
      if (this.fileIsSyncGone) {
        return "Video unavailable — missing in cloud";
      }
      if (this.fileIsSyncBlocked) {
        return "Preview unavailable — the file may be unsupported or corrupt";
      }
      return "Video not yet available — still synchronizing";
    },
    hasSlideshowFiles() {
      return this.files.some((item) => this.hasPlayableFile(item));
    },
    fullscreenSupported() {
      return (
        typeof document !== "undefined" &&
        !!document.documentElement.requestFullscreen
      );
    },
    captureDate() {
      return formatCaptureDate(this.file?.dateMedia);
    },
    placeLabel() {
      return formatPlace(this.file);
    },
    mediaAnnouncement() {
      if (!this.file) {
        return "";
      }
      const parts = [`file ${this.position + 1} of ${this.files.length}`];
      if (this.captureDate) {
        parts.push(this.captureDate);
      }
      if (this.placeLabel) {
        parts.push(this.placeLabel);
      }
      return parts.join(" — ");
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
  align-items: flex-start;
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
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
.action-bar {
  position: fixed;
  bottom: var(--space-3xl);
  left: 0;
  z-index: 200;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.action-bar-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-height: 2.6em;
  max-width: 100vw;
  padding: var(--space-xs) var(--space-md);
  background: var(--color-accent-bg);
  backdrop-filter: blur(6px);
  border-top-right-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
}
.action-menu {
  position: relative;
}
.action-menu-trigger {
  width: 2.2em;
  height: 2.2em;
  background: transparent;
  border: 1px solid rgba(170, 170, 255, 0.25);
  border-radius: var(--radius-md);
  color: var(--color-accent);
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
  bottom: calc(100% + var(--space-sm));
  min-width: 12em;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-xs);
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-sm);
  color: var(--color-accent);
  font-size: var(--font-base);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
}
.action-menu-item:hover {
  background: rgba(170, 170, 255, 0.15);
  color: var(--color-text-inverse);
}
.action-menu-item-danger:hover {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.action-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: var(--space-xs) var(--space-xs);
}
.action-checkbox input[type="checkbox"] {
  width: 1.1em;
  height: 1.1em;
  cursor: pointer;
  accent-color: var(--color-accent);
}
.action-btn {
  background: transparent;
  border: none;
  color: var(--color-accent);
  font-size: var(--font-body);
  padding: var(--space-xs) var(--space-xs);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition:
    background 0.15s,
    color 0.15s;
  white-space: nowrap;
}
.action-btn:hover:not(:disabled) {
  background: rgba(170, 170, 255, 0.15);
  color: var(--color-text-inverse);
}
.action-btn:disabled {
  opacity: 0.25;
  cursor: default;
}
.action-btn-danger:hover:not(:disabled) {
  background: var(--color-danger-bg);
  color: var(--color-danger-hover);
}
.action-bar-divider {
  width: 1px;
  height: 1.4em;
  background: rgba(170, 170, 255, 0.2);
  margin: 0 var(--space-xs);
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
  gap: var(--space-md);
  color: var(--color-accent);
  opacity: 0.75;
  font-size: var(--font-xl);
  text-align: center;
  padding: var(--space-base);
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
  top: var(--space-base);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-accent-bg);
  backdrop-filter: blur(6px);
  color: var(--color-accent);
  padding: var(--space-sm) var(--space-xl);
  border-radius: var(--radius-full);
  font-size: var(--font-body);
  z-index: 300;
  pointer-events: none;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.media-overlay {
  position: fixed;
  top: var(--space-base);
  left: var(--space-base);
  z-index: 200;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  max-width: calc(100vw - 2 * var(--space-base));
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-accent-bg);
  backdrop-filter: blur(6px);
  border-radius: var(--radius-md);
  color: var(--color-accent);
  font-size: var(--font-base);
}
.media-overlay-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.media-overlay-place {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.media-overlay-favorite {
  color: var(--color-warning);
}
.media-overlay-download {
  display: inline-flex;
  padding: var(--space-xs);
  border-radius: var(--radius-sm);
  color: var(--color-accent);
}
.media-overlay-download:hover,
.media-overlay-download:focus-visible {
  background: rgba(170, 170, 255, 0.15);
  color: var(--color-text-inverse);
}
.slideshow-controls {
  gap: var(--space-sm);
}
.slideshow-interval {
  width: auto;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-base);
}
.slideshow-toggle-active {
  background: rgba(170, 170, 255, 0.2);
}
.slideshow-status {
  font-size: var(--font-sm);
  color: var(--color-accent);
  opacity: 0.75;
}
@media (prefers-reduced-motion: reduce) {
  .animate-media-out-left,
  .animate-media-out-right,
  .animate-media-in-left,
  .animate-media-in-right {
    animation: none !important;
    transition: none !important;
    transform: none !important;
    opacity: 1 !important;
  }
}
</style>
