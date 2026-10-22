<template>
  <div class="trash-layout page">
    <TabNavigation :tabs="settingsTabs" />
    <NavigationSearch class="trash-navigation" @onAccountSelected="onAccountSelected" />
    <div class="trash-header">
      <h4>
        <i class="bi bi-trash"></i> Trash
        <small v-if="retentionDays"
          >&mdash; files are removed automatically after {{ retentionDays }} days</small
        >
      </h4>
    </div>
    <div class="trash-actions">
      <button
        v-if="files.length > 0 && authenticationStore.isAdmin"
        class="secondary outline"
        v-on:click="clickedSelect()"
      >
        <i class="bi bi-check2-square"></i> Select...
      </button>
      <kbd v-if="selectedFiles.length > 0"
        >Selected: {{ selectedFiles.length }}</kbd
      >
      <button
        v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
        class="secondary outline"
        v-on:click="clickedRestore()"
      >
        <i class="bi bi-arrow-counterclockwise"></i> Restore
      </button>
      <button
        v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
        class="secondary outline"
        v-on:click="clickedPurge()"
      >
        <i class="bi bi-x-circle"></i> Delete permanently
      </button>
    </div>
    <div class="trash-file-list">
      <Loading v-if="loading" />
      <template v-else>
        <div v-if="files.length === 0" class="trash-empty-state">
          <i class="bi bi-trash"></i>
          <p>The Trash is empty.</p>
        </div>
        <Gallery
          v-else
          :files="files"
          :enableSelection="authenticationStore.isAdmin"
          :selectedFiles="selectedFiles"
          @focusGalleryItem="focusGalleryItem"
          @onFileSelected="onFileSelected"
        />
        <div ref="sentinel" class="sentinel"></div>
        <Loading v-if="loadingMore" />
      </template>
    </div>
    <GalleryItemFocus
      v-if="displayFullScreen"
      :galleryFiles="files"
      :initialPosition="positionFocus"
      :selectedFiles="selectedFiles"
      class="gallery-item-focus"
      @onFileClosed="displayFullScreen = false"
      @onFileSelected="onFileSelected"
    />
    <DialogConfirm
      v-if="activeOperation == 'confirm-purge'"
      title="Delete Permanently"
      :message="confirmMessage"
      @onConfirm="executePurge"
      @onCancel="activeOperation = ''"
    />
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { getSettingsTabs } from "~~/utils/SettingsTabs";

export default {
  data() {
    return {
      settingsTabs: getSettingsTabs(),
      files: [],
      serverUrl: "",
      currentAccountId: "",
      selectedFiles: [],
      retentionDays: 0,
      loading: false,
      activeOperation: "",
      displayFullScreen: false,
      positionFocus: 0,
      currentPage: 0,
      pageSize: 60,
      hasMore: false,
      loadingMore: false,
      observer: null,
      confirmMessage: "",
      _onOperationComplete: null,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this._onOperationComplete = (message) => {
      const affectedFileIds = message?.fileIds || [];
      const operationName = message?.operationName || "";
      // Restore returns files to their folder; purge (fileDelete on trashed
      // rows) removes them for good: either way they leave the Trash list.
      if (
        (operationName === "fileRestore" || operationName === "fileDelete") &&
        affectedFileIds.length > 0
      ) {
        const removedSet = new Set(affectedFileIds);
        this.files = this.files.filter((f) => !removedSet.has(f.id));
        this.selectedFiles = this.selectedFiles.filter(
          (f) => !removedSet.has(f.id),
        );
      }
    };
    EventBus.on(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
    const accountsStore = AccountsStore();
    await accountsStore.fetch();
    if (accountsStore.accounts.length > 0) {
      this.currentAccountId = accountsStore.accounts[0].id;
      this.fetchTrash();
    }
  },
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          this.hasMore &&
          !this.loadingMore &&
          !this.loading
        ) {
          this.loadMore();
        }
      },
      { threshold: 0.1 },
    );
    if (this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
  },
  updated() {
    if (this.observer && this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
  },
  beforeUnmount() {
    if (this.observer) {
      this.observer.disconnect();
    }
    EventBus.off(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
  },
  methods: {
    async onAccountSelected(event) {
      if (this.currentAccountId === event.id) return;
      this.currentAccountId = event.id;
      this.fetchTrash();
    },
    async fetchTrash() {
      this.loading = true;
      this.files = [];
      this.selectedFiles = [];
      this.currentPage = 0;
      this.hasMore = false;
      try {
        await this.fetchTrashPage(0);
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    async fetchTrashPage(page) {
      const res = await axios.get(
        `${this.serverUrl}/accounts/${this.currentAccountId}/trash?page=${page}&pageSize=${this.pageSize}`,
        await AuthService.getAuthHeader(),
      );
      if (page === 0) {
        this.retentionDays = res.data.retentionDays || 0;
      }
      const newFiles = res.data.files || [];
      this.files =
        page === 0 ? newFiles : [...this.files, ...newFiles];
      this.currentPage = page;
      this.hasMore =
        (res.data.total || 0) > (page + 1) * this.pageSize;
    },
    async loadMore() {
      if (!this.hasMore || this.loadingMore || this.loading) return;
      this.loadingMore = true;
      try {
        await this.fetchTrashPage(this.currentPage + 1);
      } catch (err) {
        handleError(err);
      } finally {
        this.loadingMore = false;
      }
    },
    removeFiles(fileIds) {
      const removedSet = new Set(fileIds);
      this.files = this.files.filter((f) => !removedSet.has(f.id));
      this.selectedFiles = this.selectedFiles.filter(
        (f) => !removedSet.has(f.id),
      );
    },
    onFileSelected(file) {
      const selectedIndex = findIndex(this.selectedFiles, { id: file.id });
      if (selectedIndex < 0) {
        this.selectedFiles.push(file);
      } else {
        this.selectedFiles.splice(selectedIndex, 1);
      }
    },
    focusGalleryItem(file) {
      if (!file) {
        this.displayFullScreen = false;
        return;
      }
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    clickedSelect() {
      // Toggles selection mode off when everything is already selected
      if (this.selectedFiles.length === this.files.length) {
        this.selectedFiles = [];
        return;
      }
      this.selectedFiles = [...this.files];
    },
    async clickedRestore() {
      const fileIdList = this.selectedFiles.map((f) => f.id);
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/trash/restore`,
          { fileIdList },
          await AuthService.getAuthHeader(),
        );
        this.removeFiles(fileIdList);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Restored to their folders",
        });
      } catch (err) {
        handleError(err);
      }
    },
    clickedPurge() {
      if (this.selectedFiles.length === 1) {
        this.confirmMessage = `Permanently delete the file? (Can't be undone!)\nFile: ${this.selectedFiles[0].filename}`;
      } else {
        this.confirmMessage = `Permanently delete the ${this.selectedFiles.length} selected files? (Can't be undone!)`;
      }
      this.activeOperation = "confirm-purge";
    },
    async executePurge() {
      this.activeOperation = "";
      const fileIdList = this.selectedFiles.map((f) => f.id);
      SyncStore().markFilesAsPending(fileIdList);
      SyncStore().markOperationInProgress();
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/trash/purge`,
          { fileIdList },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Permanent deletion queued — running in background",
        });
      } catch (err) {
        handleError(err);
      }
    },
  },
};
</script>

<style scoped>
.trash-layout {
  display: grid;
  grid-template-rows: auto auto auto auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm);
  overflow: hidden;
}
.trash-header h4 {
  margin: 0;
}
.trash-header small {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}
.trash-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.trash-actions button,
.trash-actions kbd {
  padding: var(--space-xs) var(--space-sm);
  margin-right: var(--space-sm);
  font-size: var(--font-base);
}
.trash-actions kbd {
  height: 2.2em;
}
.trash-file-list {
  overflow: auto;
}
.trash-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-base);
  padding: var(--space-3xl) var(--space-2xl);
  opacity: 0.6;
  text-align: center;
}
.trash-empty-state i {
  font-size: 3em;
}
.trash-empty-state p {
  margin: 0;
}
.sentinel {
  height: 1px;
  width: 100%;
}
.gallery-item-focus {
  background-color: black;
  position: fixed;
  top: 0em;
  right: 0;
  width: 100vw;
  height: 100vh;
}
</style>
