<template>
  <SearchLayout @onAccountSelected="onAccountSelected">
    <div class="search-gallery-content">
      <div class="search-gallery-criteria">
        <input
          v-model="searchKeyword"
          type="search"
          name="search"
          placeholder="Search File"
          aria-label="Search"
          class="folder-component-layout-filter"
          v-on:input="onSearchFilterChanged"
        />
        <div class="search-gallery-content-dates">
          <label>
            From
            <input
              type="date"
              name="date"
              aria-label="Date"
              v-model="dateFrom"
              v-on:input="onSearchFilterChanged"
            />
          </label>
          <label>
            To
            <input
              type="date"
              name="date"
              aria-label="Date"
              v-model="dateTo"
              v-on:input="onSearchFilterChanged"
            />
          </label>
          <kbd v-if="files.length > 0">Images Found: {{ files.length }}</kbd>
        </div>
        <div class="search-facets">
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': isMediaTypeSelected('image') }"
            v-on:click="toggleMediaType('image')"
          >
            <i class="bi bi-image"></i> Photos
          </button>
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': isMediaTypeSelected('video') }"
            v-on:click="toggleMediaType('video')"
          >
            <i class="bi bi-camera-video"></i> Videos
          </button>
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': isMediaTypeSelected('imageRaw') }"
            v-on:click="toggleMediaType('imageRaw')"
          >
            <i class="bi bi-camera"></i> RAW
          </button>
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': hasLocation }"
            v-on:click="toggleFacet('hasLocation')"
          >
            <i class="bi bi-geo-alt"></i> Has location
          </button>
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': outtakesOnly }"
            v-on:click="toggleFacet('outtakesOnly')"
          >
            <i class="bi bi-slash-circle"></i> Outtakes
          </button>
          <button
            class="facet-chip"
            :class="{ 'facet-chip-active': favoriteOnly }"
            v-on:click="toggleFacet('favoriteOnly')"
          >
            <i :class="favoriteOnly ? 'bi bi-star-fill' : 'bi bi-star'"></i>
            Favorites
          </button>
          <select
            v-model="folderId"
            class="facet-folder-select"
            aria-label="Folder"
            v-on:change="onSearchFilterChanged"
          >
            <option value="">All folders</option>
            <option v-for="folder in accountFolders" :key="folder.id" :value="folder.id">
              {{ folder.folderpath }}
            </option>
          </select>
        </div>
        <div v-if="labels.length > 0" class="search-labels">
          <button
            v-for="label in labels"
            :key="label.label"
            class="label-chip"
            :class="{ 'facet-chip-active': isLabelActive(label.label) }"
            v-on:click="clickedLabel(label.label)"
          >
            {{ label.label }} ({{ label.count }})
          </button>
        </div>
      </div>

      <div class="search-items-actions actions">
        <button
          v-if="files.length > 0 && authenticationStore.isAdmin"
          class="secondary outline"
          v-on:click="clickedSelectAll()"
        >
          <i class="bi bi-check2-square"></i> Select all
        </button>
        <kbd v-if="selectedFiles.length > 0"
          >Selected: {{ selectedFiles.length }}</kbd
        >
        <button
          v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
          class="secondary outline"
          v-on:click="clickedDelete()"
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
        <button
          v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
          class="secondary outline"
          v-on:click="clickedMove()"
        >
          <i class="bi bi-arrows-move"></i> Move...
        </button>
      </div>
      <div class="search-item-list">
        <Loading v-if="loading" />
        <Gallery
          v-else
          :files="files"
          :enableSelection="true"
          :showFolder="true"
          @focusGalleryItem="focusGalleryItem"
          @onFileSelected="onFileSelected"
          :selectedFiles="selectedFiles"
        />
      </div>
      <GalleryItemFocus
        v-if="displayFullScreen"
        :galleryFiles="files"
        :initialPosition="positionFocus"
        :selectedFiles="selectedFiles"
        class="gallery-item-focus"
        @onFileClosed="unFocusGalleryItem"
      />
      <DialogConfirm
        v-if="activeOperation == 'confirm-delete'"
        title="Move to Trash"
        :message="confirmMessage"
        @onConfirm="executeDelete"
        @onCancel="activeOperation = ''"
      />
      <DialogMove
        v-if="activeOperation == 'move'"
        :files="selectedFiles"
        @onDone="onMoveDone"
      />
    </div>
  </SearchLayout>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { debounce, filter, find, findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

// Number of label chips rendered under the criteria area.
const LABELS_DISPLAY_MAX = 50;

export default {
  data() {
    return {
      files: [],
      analysisFiltered: [],
      analysis: [],
      menuOpened: true,
      serverUrl: "",
      selectedFile: null,
      loading: false,
      requestEtag: "",
      currentAccountId: "",
      currentFolderId: "",
      analysisFilter: "",
      searchKeyword: "",
      dateFrom: null,
      dateTo: null,
      favoriteOnly: false,
      mediaTypes: [],
      hasLocation: false,
      outtakesOnly: false,
      folderId: "",
      labels: [],
      selectedFiles: [],
      displayFullScreen: false,
      positionFocus: 0,
      activeOperation: "",
      confirmMessage: "",
      bulkDownloading: false,
    };
  },
  computed: {
    accountFolders() {
      return filter(FoldersStore().folders, {
        accountId: this.currentAccountId,
      });
    },
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
  },
  methods: {
    buildFilters() {
      const filters = {};
      if (this.searchKeyword.trim().length > 1) {
        filters.keywords = this.searchKeyword.trim();
      }
      if (this.dateFrom) {
        filters.dateFrom = new Date(this.dateFrom);
      }
      if (this.dateTo) {
        filters.dateTo = new Date(this.dateTo);
      }
      if (this.favoriteOnly) {
        filters.favoriteOnly = true;
      }
      if (this.mediaTypes.length > 0) {
        filters.mediaTypes = [...this.mediaTypes];
      }
      if (this.hasLocation) {
        filters.hasLocation = true;
      }
      if (this.outtakesOnly) {
        filters.outtakesOnly = true;
      }
      if (this.folderId) {
        filters.folderId = this.folderId;
      }
      return filters;
    },
    onSearchFilterChanged: debounce(async function (e) {
      const filters = this.buildFilters();
      // A facet toggle alone must trigger a request even when no other
      // filter is set.
      if (Object.keys(filters).length > 0) {
        this.loading = true;
        this.selectedFiles = [];
        await axios
          .post(
            `${this.serverUrl}/accounts/${this.currentAccountId}/files/search`,
            { filters },
            await AuthService.getAuthHeader(),
          )
          .then((res) => {
            this.files = res.data.files;
          })
          .catch(handleError)
          .finally(() => {
            this.loading = false;
          });
      } else {
        this.files = [];
        this.selectedFiles = [];
      }
    }, 500),
    async onAccountSelected(event) {
      this.currentAccountId = event.id;
      this.folderId = "";
      await this.fetchLabels();
      this.onSearchFilterChanged();
    },
    async fetchLabels() {
      this.labels = [];
      if (!this.currentAccountId) return;
      await axios
        .get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search/labels`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.labels = (res.data.labels || []).slice(0, LABELS_DISPLAY_MAX);
        })
        .catch(handleError);
    },
    isMediaTypeSelected(mediaType) {
      return this.mediaTypes.includes(mediaType);
    },
    toggleMediaType(mediaType) {
      const index = this.mediaTypes.indexOf(mediaType);
      if (index >= 0) {
        this.mediaTypes.splice(index, 1);
      } else {
        this.mediaTypes.push(mediaType);
      }
      this.onSearchFilterChanged();
    },
    toggleFacet(facet) {
      this[facet] = !this[facet];
      this.onSearchFilterChanged();
    },
    isLabelActive(label) {
      return this.searchKeyword.trim().toLowerCase() === label;
    },
    clickedLabel(label) {
      if (this.isLabelActive(label)) {
        this.searchKeyword = "";
      } else {
        this.searchKeyword = label;
      }
      this.onSearchFilterChanged();
    },
    updateDateFrom(event) {
      this.dateFrom = new Date(event);
      this.onSearchFilterChanged();
    },
    updateDateTo(event) {
      this.dateTo = new Date(event);
      this.onSearchFilterChanged();
    },
    onFileSelected(file) {
      const selectedIndex = findIndex(this.selectedFiles, { id: file.id });
      if (selectedIndex < 0) {
        this.selectedFiles.push(file);
      } else {
        this.selectedFiles.splice(selectedIndex, 1);
      }
    },
    clickedSelectAll() {
      this.selectedFiles = [...this.files];
    },
    clickedDelete() {
      if (this.selectedFiles.length === 1) {
        this.confirmMessage = `Move the file to Trash? (Restorable for 30 days)\nFile: ${this.selectedFiles[0].filename}`;
      } else {
        this.confirmMessage = `Move the ${this.selectedFiles.length} selected files to Trash? (Restorable for 30 days)`;
      }
      this.activeOperation = "confirm-delete";
    },
    async executeDelete() {
      this.activeOperation = "";
      const fileIdList = this.selectedFiles.map((f) => f.id);
      SyncStore().markFilesAsPending(fileIdList);
      SyncStore().markOperationInProgress();
      await axios
        .post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/batch/operations/fileDelete`,
          { fileIdList },
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          this.selectedFiles = [];
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            text: "Moved to Trash",
          });
          this.fetchLabels();
          this.onSearchFilterChanged();
        })
        .catch(handleError);
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
    clickedMove() {
      this.activeOperation = "move";
    },
    onMoveDone() {
      this.activeOperation = "";
      this.selectedFiles = [];
      this.fetchLabels();
      this.onSearchFilterChanged();
    },
    focusGalleryItem(file) {
      if (!file) {
        this.displayFullScreen = false;
        return;
      }
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    unFocusGalleryItem(result) {
      this.displayFullScreen = false;
    },
  },
};
</script>

<style scoped>
.search-gallery-content {
  min-height: 0;
  overflow-y: auto;
}

.search-gallery-content-dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--space-base);
}

.search-gallery-content-dates input {
  min-width: 0;
}

@media (max-width: 480px) {
  .search-gallery-content-dates {
    grid-template-columns: minmax(0, 1fr);
  }
}

.search-facets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.facet-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: var(--font-sm);
  cursor: pointer;
  user-select: none;
}

.facet-chip:hover {
  background: var(--color-bg-hover);
}

.facet-chip-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.facet-folder-select {
  margin: 0;
  max-width: 16em;
  font-size: var(--font-sm);
  color: var(--color-text);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-xs) var(--space-sm);
}

.search-labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.label-chip {
  display: inline-flex;
  align-items: center;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
  user-select: none;
}

.label-chip:hover {
  background: var(--color-bg-hover);
}

.label-chip.facet-chip-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.search-items-actions button,
.search-items-actions kbd {
  padding: var(--space-xs) var(--space-sm);
  margin-right: var(--space-sm);
  font-size: var(--font-base);
}

@media (prefers-color-scheme: dark) {
  .source-active {
    background-color: var(--color-bg-hover);
  }
  .gallery-folders {
    background-color: var(--color-bg-secondary);
  }
}
@media (prefers-color-scheme: light) {
  .source-active {
    background-color: var(--color-bg-hover);
  }
  .gallery-folders {
    background-color: var(--color-bg-secondary);
  }
}
.gallery-item-focus {
  background-color: black;
  position: fixed;
  top: 0em;
  right: 0;
  width: 100vw;
  height: 100vh;
}
.search-file-list-file {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr auto;
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  padding-bottom: var(--space-sm);
  border-top: 1px solid var(--color-border);
}
.search-file-list-file-name {
  word-break: break-all;
}
.search-file-list-file-actions i {
  padding-left: var(--space-base);
  padding-right: var(--space-sm);
}
.search-item {
  margin-top: var(--space-base);
}
</style>
