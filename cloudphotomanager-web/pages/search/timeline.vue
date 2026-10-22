<template>
  <SearchLayout @onAccountSelected="onAccountSelected">
    <div class="timeline-layout">
      <div class="timeline-header">
        <button
          class="secondary outline"
          :disabled="!hasNewer"
          v-on:click="selectAdjacentMonth(-1)"
          title="Newer"
        >
          <i class="bi bi-chevron-left"></i>
        </button>
        <h4>{{ currentMonthLabel }}</h4>
        <button
          class="secondary outline"
          :disabled="!hasOlder"
          v-on:click="selectAdjacentMonth(1)"
          title="Older"
        >
          <i class="bi bi-chevron-right"></i>
        </button>
        <select
          v-if="months.length > 0"
          class="timeline-month-select"
          :value="currentMonthKey"
          v-on:change="onMonthSelected($event)"
        >
          <option
            v-for="m in months"
            :key="m.year + m.month"
            :value="monthKey(m)"
          >
            {{ monthLabel(m) }} ({{ m.count }})
          </option>
        </select>
      </div>
      <div class="timeline-actions">
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
          v-on:click="clickedTrash()"
        >
          <i class="bi bi-trash-fill"></i> Trash
        </button>
        <button
          v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
          class="secondary outline"
          :disabled="bulkDownloading"
          v-on:click="clickedDownload()"
        >
          <i class="bi bi-download"></i>
          {{ bulkDownloading ? "Zipping..." : "Download" }}
        </button>
      </div>
      <div class="timeline-file-list">
        <Loading v-if="loading" />
        <template v-else>
          <div v-if="files.length === 0" class="timeline-empty-state">
            <i class="bi bi-clock-history"></i>
            <p>No photos for this month.</p>
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
        v-if="activeOperation == 'confirm-trash'"
        title="Move to Trash"
        :message="confirmMessage"
        @onConfirm="executeTrash"
        @onCancel="activeOperation = ''"
      />
    </div>
  </SearchLayout>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { FileUtils } from "~~/services/FileUtils";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default {
  data() {
    return {
      files: [],
      serverUrl: "",
      currentAccountId: "",
      selectedFiles: [],
      months: [],
      currentYear: 0,
      currentMonth: 0,
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
      bulkDownloading: false,
      _requestEtag: "",
      _onOperationComplete: null,
    };
  },
  computed: {
    currentMonthKey() {
      return this.monthKey({
        year: String(this.currentYear),
        month: String(this.currentMonth),
      });
    },
    currentMonthLabel() {
      if (!this.currentYear || !this.currentMonth) {
        return "Timeline";
      }
      const entry = this.months.find(
        (m) =>
          Number(m.year) === this.currentYear &&
          Number(m.month) === this.currentMonth,
      );
      return `${MONTH_NAMES[this.currentMonth - 1]} ${this.currentYear}${
        entry ? ` (${entry.count})` : ""
      }`;
    },
    currentIndex() {
      return this.months.findIndex(
        (m) =>
          Number(m.year) === this.currentYear &&
          Number(m.month) === this.currentMonth,
      );
    },
    hasNewer() {
      return this.currentIndex > 0;
    },
    hasOlder() {
      return (
        this.currentIndex >= 0 && this.currentIndex < this.months.length - 1
      );
    },
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this._onOperationComplete = (message) => {
      const affectedFileIds = message?.fileIds || [];
      const operationName = message?.operationName || "";
      if (
        (operationName === "fileDelete" || operationName === "fileTrash") &&
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
    await AccountsStore().fetch();
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
          this.loadMoreFiles();
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
    monthKey(m) {
      return `${m.year}-${m.month}`;
    },
    monthLabel(m) {
      return `${MONTH_NAMES[Number(m.month) - 1]} ${m.year}`;
    },
    async onAccountSelected(event) {
      if (this.currentAccountId === event.id) return;
      this.currentAccountId = event.id;
      await this.fetchMonths();
    },
    async fetchMonths() {
      this.loading = true;
      try {
        const res = await axios.get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/timeline/months`,
          await AuthService.getAuthHeader(),
        );
        this.months = res.data.months || [];
        if (this.months.length > 0) {
          const keepKey = this.currentMonthKey;
          const stillThere = this.months.some(
            (m) => this.monthKey(m) === keepKey,
          );
          if (!stillThere) {
            this.selectMonth(this.months[0]);
          } else {
            await this.fetchFiles();
          }
        } else {
          this.currentYear = 0;
          this.currentMonth = 0;
          this.files = [];
        }
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    selectMonth(m) {
      this.currentYear = Number(m.year);
      this.currentMonth = Number(m.month);
      this.fetchFiles();
    },
    selectAdjacentMonth(direction) {
      const target = this.months[this.currentIndex + direction];
      if (target) {
        this.selectMonth(target);
      }
    },
    onMonthSelected(event) {
      const target = this.months.find(
        (m) => this.monthKey(m) === event.target.value,
      );
      if (target) {
        this.selectMonth(target);
      }
    },
    async fetchFiles() {
      const requestEtag = new Date().toISOString();
      this._requestEtag = requestEtag;
      this.loading = true;
      this.selectedFiles = [];
      this.displayFullScreen = false;
      try {
        const res = await axios.get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/timeline?year=${this.currentYear}&month=${this.currentMonth}&page=0&pageSize=${this.pageSize}`,
          await AuthService.getAuthHeader(),
        );
        if (this._requestEtag !== requestEtag) return;
        this.files = res.data.files || [];
        this.currentPage = 0;
        this.hasMore =
          (res.data.total || 0) > (this.currentPage + 1) * this.pageSize;
      } catch (err) {
        handleError(err);
      } finally {
        if (this._requestEtag === requestEtag) {
          this._requestEtag = "";
          this.loading = false;
        }
      }
    },
    async loadMoreFiles() {
      if (!this.hasMore || this.loadingMore || this.loading) return;
      this.loadingMore = true;
      const nextPage = this.currentPage + 1;
      try {
        const res = await axios.get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/timeline?year=${this.currentYear}&month=${this.currentMonth}&page=${nextPage}&pageSize=${this.pageSize}`,
          await AuthService.getAuthHeader(),
        );
        this.files = [...this.files, ...(res.data.files || [])];
        this.currentPage = nextPage;
        this.hasMore =
          (res.data.total || 0) > (nextPage + 1) * this.pageSize;
      } catch (err) {
        handleError(err);
      } finally {
        this.loadingMore = false;
      }
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
      if (FileUtils.getType(file) === "unknown") {
        return;
      }
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    clickedSelect() {
      if (this.selectedFiles.length === this.files.length) {
        this.selectedFiles = [];
        return;
      }
      this.selectedFiles = [...this.files];
    },
    clickedTrash() {
      if (this.selectedFiles.length === 1) {
        this.confirmMessage = `Move the file to Trash? (Restorable for 30 days)\nFile: ${this.selectedFiles[0].filename}`;
      } else {
        this.confirmMessage = `Move the ${this.selectedFiles.length} selected files to Trash? (Restorable for 30 days)`;
      }
      this.activeOperation = "confirm-trash";
    },
    async executeTrash() {
      this.activeOperation = "";
      const accountId = this.currentAccountId;
      const fileIdList = this.selectedFiles.map((f) => f.id);
      SyncStore().markFilesAsPending(fileIdList);
      SyncStore().markOperationInProgress();
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${accountId}/files/batch/operations/fileDelete`,
          { fileIdList },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Moved to Trash" });
      } catch (err) {
        handleError(err);
      }
    },
    async clickedDownload() {
      if (this.bulkDownloading) return;
      this.bulkDownloading = true;
      const fileIdList = this.selectedFiles.map((f) => f.id);
      try {
        const res = await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/batch/operations/fileDownload`,
          { fileIdList },
          { responseType: "blob" },
        );
        const url = URL.createObjectURL(res.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = `photos-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .substring(0, 19)}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Download started",
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.bulkDownloading = false;
      }
    },
  },
};
</script>

<style scoped>
.timeline-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm);
  min-height: 0;
  overflow: hidden;
}
.timeline-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.timeline-header h4 {
  margin: 0;
  min-width: 12em;
  text-align: center;
}
.timeline-header button {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-base);
}
.timeline-month-select {
  max-width: 100%;
  font-size: var(--font-base);
  padding: var(--space-xs) var(--space-sm);
}
@media (max-width: 480px) {
  .timeline-header h4 {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-lg);
  }
  .timeline-month-select {
    width: 100%;
  }
}
.timeline-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.timeline-actions button,
.timeline-actions kbd {
  padding: var(--space-xs) var(--space-sm);
  margin-right: var(--space-sm);
  font-size: var(--font-base);
}
.timeline-actions kbd {
  height: 2.2em;
}
.timeline-file-list {
  overflow: auto;
}
.timeline-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-base);
  padding: var(--space-3xl) var(--space-2xl);
  opacity: 0.6;
  text-align: center;
}
.timeline-empty-state i {
  font-size: 3em;
}
.timeline-empty-state p {
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
