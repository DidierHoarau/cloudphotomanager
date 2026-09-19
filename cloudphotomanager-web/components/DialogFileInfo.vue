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
    <div class="dialog-overlay" @click.self="clickedClose()">
      <article class="dialog-article dialog-article--wide">
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            @click.prevent="clickedClose()"
          ></a>
          File Info
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
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

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
    };
  },
  async created() {
    await this.loadDuplicates();
  },
  methods: {
    clickedClose() {
      this.$emit("onClose");
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
      this.confirmDeleteMessage = `Delete this duplicate? (Can't be undone!)\nFile: ${dup.filename}`;
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
          text: "Delete queued \u2014 running in background",
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
</style>
