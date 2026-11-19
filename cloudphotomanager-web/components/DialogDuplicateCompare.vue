<template>
  <div class="dialog-overlay" @click.self="clickedClose()" @keydown="onDialogKeydown">
    <article
      ref="dialogArticle"
      class="dialog-article dialog-article--wide dialog-dup-compare"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-compare-title"
      tabindex="-1"
    >
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          @click.prevent="clickedClose()"
        ></a>
        <span id="duplicate-compare-title">Compare Duplicate Copies</span>
      </header>

      <p class="dialog-dup-compare-reason" role="status">
        <i class="bi bi-stars" aria-hidden="true"></i>
        Suggested: {{ suggestedFilename }} — {{ suggestionReason }}
      </p>

      <fieldset class="dialog-dup-compare-fieldset">
        <legend>Keep this copy</legend>
        <div class="dialog-dup-compare-grid">
          <div
            v-for="file in files"
            :key="file.id"
            class="dialog-dup-compare-card"
            :class="{ 'dialog-dup-compare-card--suggested': isSuggested(file) }"
          >
            <div class="dialog-dup-compare-thumb">
              <LazyMediaThumbnail :file="file" />
            </div>
            <span
              v-if="isSuggested(file)"
              class="dialog-dup-compare-badge"
              >Suggested</span
            >
            <span class="dialog-dup-compare-path">{{ pathFor(file) }}</span>
            <span class="dialog-dup-compare-name">{{ file.filename }}</span>
            <dl class="dialog-dup-compare-meta">
              <dt>Dimensions</dt>
              <dd>{{ dimensionsFor(file) }}</dd>
              <dt>Size</dt>
              <dd>{{ formatSize(file.info && file.info.size) }}</dd>
              <dt>Captured</dt>
              <dd>{{ formatDate(captureDateFor(file)) }}</dd>
            </dl>
            <label class="dialog-dup-compare-choice">
              <input
                v-model="localKeepId"
                type="radio"
                name="duplicate-keep"
                :value="file.id"
                @change="onKeepChanged"
              />
              Keep this copy
            </label>
          </div>
        </div>
      </fieldset>

      <footer class="dialog-dup-compare-actions">
        <button
          type="button"
          class="secondary outline"
          :disabled="mutationsDisabled"
          :aria-label="ignoreAriaLabel"
          :title="mutationTitle"
          @click="clickedIgnore()"
        >
          <i class="bi bi-hand-thumbs-up"></i> Keep both — ignore this group
        </button>
        <button
          type="button"
          :disabled="mutationsDisabled || removalCount === 0"
          :aria-label="trashAriaLabel"
          @click="clickedTrash()"
        >
          <i class="bi bi-trash"></i> Move {{ removalCount }} other
          {{ removalCount === 1 ? "copy" : "copies" }} to Trash
        </button>
        <button type="button" class="secondary outline" @click="clickedClose()">
          Close
        </button>
      </footer>
    </article>
  </div>
</template>

<script>
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";
import {
  duplicateCaptureTime,
  suggestDuplicateKeep,
} from "~~/utils/DuplicateReview";

export default {
  props: {
    group: {
      type: Object,
      required: true,
    },
    folderPaths: {
      type: [Object, Map],
      default: null,
    },
    suggestedKeepId: {
      type: String,
      default: null,
    },
    initialKeepId: {
      type: String,
      default: null,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isOnline: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      localKeepId: this.initialKeepId || this.suggestedKeepId || null,
      restoreFocusElement: null,
    };
  },
  created() {
    if (typeof document !== "undefined") {
      this.restoreFocusElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
  },
  mounted() {
    this.$nextTick(() => dialogFocusFirst(this.$refs.dialogArticle));
  },
  beforeUnmount() {
    if (
      this.restoreFocusElement &&
      document.contains(this.restoreFocusElement)
    ) {
      this.restoreFocusElement.focus();
    }
  },
  computed: {
    files() {
      return (this.group && this.group.files) || [];
    },
    removalCount() {
      return this.files.filter((file) => file.id !== this.localKeepId).length;
    },
    suggestionReason() {
      return suggestDuplicateKeep(this.files, this.folderPaths).reason;
    },
    suggestedFilename() {
      const suggested = this.files.find((file) => this.isSuggested(file));
      return suggested ? suggested.filename : "";
    },
    mutationsDisabled() {
      return !this.isAdmin || !this.isOnline;
    },
    mutationTitle() {
      if (!this.isAdmin) return "Admin only";
      if (!this.isOnline) return "Unavailable while offline";
      return "";
    },
    trashAriaLabel() {
      const base = `Move ${this.removalCount} other ${
        this.removalCount === 1 ? "copy" : "copies"
      } to Trash`;
      if (!this.isAdmin) return `${base} (admin only)`;
      if (!this.isOnline) return `${base} (unavailable offline)`;
      return base;
    },
    ignoreAriaLabel() {
      const base = "Keep both — ignore this duplicate group";
      if (!this.isAdmin) return `${base} (admin only)`;
      if (!this.isOnline) return `${base} (unavailable offline)`;
      return base;
    },
  },
  methods: {
    isSuggested(file) {
      return file.id === this.suggestedKeepId;
    },
    pathFor(file) {
      const folderPath = this.folderPathGet(file.folderId);
      return folderPath === null
        ? "Unknown folder"
        : `${folderPath === "/" ? "" : folderPath}/${file.filename}`;
    },
    folderPathGet(folderId) {
      const paths = this.folderPaths;
      if (!paths || !folderId) return null;
      if (paths instanceof Map) {
        return paths.get(folderId) ?? null;
      }
      const value = paths[folderId];
      return typeof value === "string" ? value : null;
    },
    dimensionsFor(file) {
      const metadata = file && file.metadata;
      if (!metadata) return "Unknown";
      let best = null;
      for (const key of ["image", "video", "photo"]) {
        const media = metadata[key];
        if (!media) continue;
        const width = Number(media.width);
        const height = Number(media.height);
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0 &&
          (!best || width * height > best.width * best.height)
        ) {
          best = { width, height };
        }
      }
      return best ? `${best.width}×${best.height}` : "Unknown";
    },
    captureDateFor(file) {
      const time = duplicateCaptureTime(file);
      return time === null ? null : new Date(time);
    },
    formatDate(date) {
      if (!date) return "Unknown";
      return new Date(date).toLocaleString();
    },
    formatSize(bytes) {
      if (!bytes && bytes !== 0) return "Unknown";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    },
    onKeepChanged() {
      this.$emit("onKeepSelected", this.group.hash, this.localKeepId);
    },
    clickedTrash() {
      this.$emit("onRequestTrash", this.group.hash, this.localKeepId);
    },
    clickedIgnore() {
      this.$emit("onRequestIgnore", this.group.hash);
    },
    clickedClose() {
      this.$emit("onClose");
    },
    onDialogKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.clickedClose();
        return;
      }
      dialogTrapFocus(event, this.$refs.dialogArticle);
    },
  },
};
</script>
