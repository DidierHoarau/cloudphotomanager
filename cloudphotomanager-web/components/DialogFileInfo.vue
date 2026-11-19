<template>
  <div>
    <div v-if="showConfirmDelete" class="confirm-overlay">
      <DialogConfirm
        title="Confirm Delete"
        :message="confirmDeleteMessage"
        @onConfirm="executeDeleteDuplicate"
        @onCancel="showConfirmDelete = false"
      />
    </div>
    <div
      class="dialog-overlay"
      @click.self="clickedClose()"
      @keydown="onDialogKeydown"
    >
      <article
        ref="dialogArticle"
        class="dialog-article dialog-article--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-file-info-title"
        tabindex="-1"
      >
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            @click.prevent="clickedClose()"
          ></a>
          <span id="dialog-file-info-title">File Info</span>
        </header>
        <div class="dialog-thumbnail">
          <LazyMediaThumbnail :file="file" />
        </div>
        <div class="dialog-info-grid">
          <div class="dialog-info-item">
            <span class="dialog-info-item-label">Name</span>
            <span class="dialog-info-item-value">
              {{ file.filename }}
              <button
                class="dialog-copy-btn"
                title="Copy filename"
                aria-label="Copy filename"
                @click="copyText(file.filename, 'name')"
              >
                <i
                  class="bi"
                  :class="copiedKey === 'name' ? 'bi-clipboard-check' : 'bi-clipboard'"
                ></i>
              </button>
            </span>
          </div>
          <div class="dialog-info-item">
            <span class="dialog-info-item-label">Location</span>
            <span class="dialog-info-item-value">
              <NuxtLink
                :to="folderLink(file.accountId, file.folderId)"
                @click="clickedClose()"
              >
                {{ folderPath }}
              </NuxtLink>
              <button
                class="dialog-copy-btn"
                title="Copy folder path"
                aria-label="Copy folder path"
                @click="copyText(folderPath, 'path')"
              >
                <i
                  class="bi"
                  :class="copiedKey === 'path' ? 'bi-clipboard-check' : 'bi-clipboard'"
                ></i>
              </button>
            </span>
          </div>
          <div class="dialog-info-item">
            <span class="dialog-info-item-label">Date</span>
            <span class="dialog-info-item-value">{{
              formatDate(file.dateMedia || file.dateSync)
            }}</span>
          </div>
          <div class="dialog-info-item">
            <span class="dialog-info-item-label">Size</span>
            <span class="dialog-info-item-value">{{
              formatSize(file.info && file.info.size)
            }}</span>
          </div>
          <div v-if="gpsCoords" class="dialog-info-item">
            <span class="dialog-info-item-label">Location (GPS)</span>
            <span class="dialog-info-item-value">
              <NuxtLink :to="mapLink" @click="clickedClose()">
                {{ displayCoords }} <i class="bi bi-geo-alt"></i> Show on map
              </NuxtLink>
            </span>
          </div>
          <div v-if="placeLabel" class="dialog-info-item">
            <span class="dialog-info-item-label">Place</span>
            <span class="dialog-info-item-value">
              <NuxtLink :to="placeLink" @click="clickedClose()">
                {{ placeLabel }} <i class="bi bi-search"></i> Search photos here
              </NuxtLink>
            </span>
          </div>
          <div v-if="keywords.length > 0" class="dialog-info-item">
            <span class="dialog-info-item-label">Keywords</span>
            <span class="dialog-info-item-value dialog-keywords">
              <NuxtLink
                v-for="keyword in keywords"
                :key="keyword"
                class="dialog-keyword-chip"
                :to="keywordLink(keyword)"
                @click="clickedClose()"
              >
                {{ keyword }}
              </NuxtLink>
            </span>
          </div>
          <div v-if="showEnrichment" class="dialog-info-item">
            <span class="dialog-info-item-label">Labels</span>
            <span class="dialog-info-item-value">
              <span
                class="dialog-enrichment-status"
                :class="`dialog-enrichment-${enrichmentStatusClass}`"
                >{{ enrichmentLabel }}</span
              >
              <small
                v-if="enrichmentError"
                class="dialog-enrichment-error"
                role="status"
                >{{ enrichmentError }}</small
              >
              <button
                v-if="canRetryLabels"
                type="button"
                class="dialog-copy-btn dialog-enrichment-retry"
                :disabled="retryingEnrichment || !isOnline"
                :aria-label="retryLabelAria"
                :title="retryLabelTitle"
                @click="retryEnrichment"
              >
                <i
                  class="bi"
                  :class="
                    retryingEnrichment ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'
                  "
                ></i>
                <span class="dialog-enrichment-retry-text">Retry enrichment</span>
              </button>
            </span>
          </div>
          <div v-if="canDownloadOriginal" class="dialog-info-item">
            <span class="dialog-info-item-label">Original</span>
            <span class="dialog-info-item-value">
              <a :href="downloadHref" :download="file.filename"
                ><i class="bi bi-download"></i> Download original</a
              >
            </span>
          </div>
        </div>
        <hr />
        <strong>Duplicates</strong>
        <Loading v-if="loadingDuplicates" />
        <p v-else-if="!duplicates"><small>No duplicates found.</small></p>
        <div v-else class="dialog-dup-card-list">
          <div
            v-for="dup in duplicates.files"
            :key="dup.id"
            class="dialog-dup-card"
          >
            <div class="dialog-dup-card-thumb">
              <LazyMediaThumbnail :file="dup" />
            </div>
            <div class="dialog-dup-card-info">
              <NuxtLink
                class="dialog-dup-card-path"
                :to="folderLink(dup.accountId, dup.folderId)"
                @click="clickedClose()"
              >
                {{ getDuplicateFolderPath(dup.folderId) }}
              </NuxtLink>
              <span class="dialog-dup-card-name">{{ dup.filename }}</span>
            </div>
            <button
              v-if="isAdmin"
              class="dialog-delete-btn"
              @click="clickedDeleteDuplicate(dup)"
              :disabled="isDupProcessing(dup.id)"
              title="Delete this duplicate"
            >
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
const foldersStore = FoldersStore();
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { GeoUtils } from "~~/services/GeoUtils";
import { FileUtils } from "~~/services/FileUtils";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";
import {
  canRetryEnrichment,
  enrichmentErrorText,
  enrichmentStatusLabel,
} from "~~/utils/SyncHealth";

export default {
  props: {
    file: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      duplicates: null,
      loadingDuplicates: false,
      showConfirmDelete: false,
      confirmDeleteMessage: "",
      pendingDeleteDup: null,
      copiedKey: null,
      serverUrl: "",
      retryingEnrichment: false,
      localEnrichmentStatus: null,
      isOnline: true,
      restoreFocusElement: null,
    };
  },
  async created() {
    if (typeof document !== "undefined") {
      this.restoreFocusElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (typeof navigator !== "undefined") {
      this.isOnline = navigator.onLine;
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onNetworkOnline);
      window.addEventListener("offline", this.onNetworkOffline);
    }
    this.$nextTick(() => dialogFocusFirst(this.$refs.dialogArticle));
    this.serverUrl = (await Config.get()).SERVER_URL;
    await this.loadDuplicates();
  },
  beforeUnmount() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onNetworkOnline);
      window.removeEventListener("offline", this.onNetworkOffline);
    }
    // Give focus back to the control that opened the dialog.
    if (
      this.restoreFocusElement &&
      document.contains(this.restoreFocusElement)
    ) {
      this.restoreFocusElement.focus();
    }
  },
  methods: {
    onNetworkOnline() {
      this.isOnline = true;
    },
    onNetworkOffline() {
      this.isOnline = false;
    },
    onDialogKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.clickedClose();
        return;
      }
      dialogTrapFocus(event, this.$refs.dialogArticle);
    },
    async retryEnrichment() {
      if (this.retryingEnrichment) {
        return;
      }
      this.retryingEnrichment = true;
      try {
        await axios.post(
          `${(await Config.get()).SERVER_URL}/sync/enrichment/retry/${encodeURIComponent(
            this.file.id,
          )}`,
          {},
          await AuthService.getAuthHeader(),
        );
        this.localEnrichmentStatus = "pending";
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Label enrichment re-queued",
        });
        this.$emit("onEnrichmentRetried", this.file.id);
      } catch (err) {
        handleError(err);
      } finally {
        this.retryingEnrichment = false;
      }
    },
    clickedClose() {
      this.$emit("onClose");
    },
    keywordLink(keyword) {
      return {
        path: "/search",
        query: { accountId: this.file.accountId, keywords: keyword },
      };
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
    folderLink(accountId, folderId) {
      return { path: "/gallery", query: { accountId, folderId } };
    },
    async copyText(value, key) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        this.copiedKey = key;
        setTimeout(() => {
          if (this.copiedKey === key) this.copiedKey = null;
        }, 1500);
      } catch (err) {
        handleError(err);
      }
    },
    async loadDuplicates() {
      this.loadingDuplicates = true;
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/${this.file.accountId}/analysis/duplicates/${this.file.id}`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.duplicates = res.data.duplicate;
        })
        .catch(handleError)
        .finally(() => {
          this.loadingDuplicates = false;
        });
    },
    getDuplicateFolderPath(folderId) {
      const folder = FoldersStore().folders.find((f) => f.id === folderId);
      return folder ? folder.folderpath : folderId;
    },
    clickedDeleteDuplicate(dup) {
      this.confirmDeleteMessage = `Move this duplicate to Trash? (Restorable for 30 days)\nFile: ${dup.filename}`;
      this.pendingDeleteDup = dup;
      this.showConfirmDelete = true;
    },
    async executeDeleteDuplicate() {
      this.showConfirmDelete = false;
      const dup = this.pendingDeleteDup;
      if (!dup) return;
      this.pendingDeleteDup = null;
      SyncStore().markFilesAsPending([dup.id]);
      SyncStore().markOperationInProgress();
      try {
        await axios.post(
          `${(await Config.get()).SERVER_URL}/accounts/${dup.accountId}/files/batch/operations/fileDelete`,
          { fileIdList: [dup.id] },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Moved to Trash",
        });
        // Remove from local list
        if (this.duplicates && this.duplicates.files) {
          this.duplicates.files = this.duplicates.files.filter(
            (f) => f.id !== dup.id,
          );
        }
        this.$emit("onDuplicateDeleted", dup.id);
      } catch (err) {
        handleError(err);
      }
    },
    isDupProcessing(fileId) {
      return SyncStore().isFileProcessing(fileId);
    },
  },
  computed: {
    folderPath() {
      const folder = FoldersStore().folders.find(
        (f) => f.id === this.file.folderId,
      );
      return folder ? folder.folderpath : this.file.folderId;
    },
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
    canDownloadOriginal() {
      const capabilities = AccountsStore().capabilitiesFor(
        this.file.accountId,
      );
      return !!(capabilities && capabilities.downloadFileOriginal);
    },
    downloadHref() {
      return `${this.serverUrl}/files/${encodeURIComponent(this.file.id)}/download`;
    },
    gpsCoords() {
      return GeoUtils.getGpsCoords(this.file);
    },
    placeLabel() {
      return [
        this.file.placeCity,
        this.file.placeRegion,
        this.file.placeCountry,
      ]
        .filter(Boolean)
        .join(", ");
    },
    placeLink() {
      const query = { accountId: this.file.accountId };
      if (this.file.placeCountry) query.placeCountry = this.file.placeCountry;
      if (this.file.placeRegion) query.placeRegion = this.file.placeRegion;
      if (this.file.placeCity) query.placeCity = this.file.placeCity;
      return { path: "/search", query };
    },
    keywords() {
      const raw = String(this.file.keywords ?? "").trim();
      if (!raw) return [];
      const seen = new Set();
      const tokens = [];
      for (const token of raw.split(/\s+/)) {
        if (!token) continue;
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(token);
      }
      return tokens;
    },
    displayCoords() {
      if (!this.gpsCoords) return "";
      return `${this.gpsCoords.lat.toFixed(5)}, ${this.gpsCoords.lon.toFixed(5)}`;
    },
    mapLink() {
      return {
        path: "/search/map",
        query: {
          accountId: this.file.accountId,
          lat: this.gpsCoords.lat,
          lon: this.gpsCoords.lon,
          zoom: 16,
        },
      };
    },
    showEnrichment() {
      return FileUtils.isImage(this.file);
    },
    enrichmentStatus() {
      if (this.localEnrichmentStatus) {
        return this.localEnrichmentStatus;
      }
      return this.file.enrichmentStatus || null;
    },
    enrichmentFile() {
      return {
        enrichmentStatus: this.enrichmentStatus,
        lastEnrichmentError: this.file.lastEnrichmentError,
        enrichmentFailCount: this.file.enrichmentFailCount,
      };
    },
    enrichmentLabel() {
      return enrichmentStatusLabel(this.enrichmentFile);
    },
    enrichmentError() {
      return enrichmentErrorText(this.enrichmentFile);
    },
    enrichmentStatusClass() {
      return this.enrichmentStatus || "unknown";
    },
    canRetryLabels() {
      return (
        this.isAdmin && canRetryEnrichment(this.enrichmentFile, this.isOnline)
      );
    },
    retryLabelAria() {
      if (!this.isOnline) {
        return "Retry label enrichment (offline)";
      }
      return this.retryingEnrichment
        ? "Retrying label enrichment"
        : "Retry label enrichment";
    },
    retryLabelTitle() {
      return this.isOnline
        ? "Re-queue label enrichment for this file"
        : "Unavailable while offline";
    },
  },
};
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay);
}
.dialog-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.dialog-keyword-chip {
  display: inline-flex;
  padding: 0 var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--font-xs);
  text-decoration: none;
}
.dialog-keyword-chip:hover {
  background: var(--color-bg-hover);
}
</style>
