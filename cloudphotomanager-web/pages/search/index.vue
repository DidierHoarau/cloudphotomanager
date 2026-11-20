<template>
  <SearchLayout
    :initialAccountId="initialAccountId"
    @onAccountSelected="onAccountSelected"
  >
    <div class="search-gallery-content">
      <div class="search-gallery-criteria">
        <input
          v-model="searchKeyword"
          type="search"
          name="search"
          placeholder="Search File or Place"
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
          <select
            v-model="placeFilterKey"
            class="facet-folder-select"
            aria-label="Place"
            v-on:change="onPlaceChanged"
          >
            <option value="">All places</option>
            <option
              v-for="option in placeOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }} ({{ option.count }})
            </option>
          </select>
          <select
            v-model="sort"
            class="facet-folder-select"
            aria-label="Sort"
            v-on:change="onSearchFilterChanged"
          >
            <option
              v-for="option in sortOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <button
            v-if="bbox"
            class="facet-chip facet-chip-active"
            title="Clear the map area filter"
            v-on:click="clearBbox()"
          >
            <i class="bi bi-map"></i> Map area <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div v-if="labels.length > 0" class="search-labels">
          <input
            v-model="labelFilter"
            type="search"
            class="search-label-filter"
            placeholder="Filter labels"
            aria-label="Filter labels"
          />
          <button
            v-for="label in filteredLabels"
            :key="label.label"
            class="label-chip"
            :class="{ 'facet-chip-active': isLabelActive(label.label) }"
            v-on:click="clickedLabel(label.label)"
          >
            {{ label.label }} ({{ label.count }})
          </button>
          <small v-if="filteredLabels.length === 0" class="search-labels-empty">
            No label matches "{{ labelFilter }}"
          </small>
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
        <button
          v-if="files.length > 0"
          class="secondary outline"
          v-on:click="clickedSlideshow()"
        >
          <i class="bi bi-play-fill"></i> Slideshow
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
        <button
          v-if="selectedFiles.length > 0 && authenticationStore.isAdmin"
          class="secondary outline"
          v-on:click="clickedAddToAlbum()"
        >
          <i class="bi bi-collection"></i> Add to Album...
        </button>
      </div>
      <div v-if="total > 0" class="search-results-header">
        <kbd>Showing {{ files.length }} of {{ total }}</kbd>
        <small v-if="hasMore" class="search-results-notice">
          Results are limited to {{ pageSize }} per page; load more to see the
          rest.
        </small>
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
      <div v-if="hasMore" class="search-load-more">
        <button
          class="secondary outline"
          :disabled="loadingMore"
          v-on:click="loadMore()"
        >
          <i class="bi bi-arrow-down-circle"></i>
          {{ loadingMore ? "Loading..." : "Load more" }}
        </button>
      </div>
      <GalleryItemFocus
        v-if="displayFullScreen"
        :galleryFiles="slideshowMode ? viewerFiles : files"
        :initialPosition="positionFocus"
        :selectedFiles="selectedFiles"
        :slideshow="slideshowMode"
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
      <DialogAddToAlbum
        v-if="activeOperation == 'add-to-album'"
        :files="selectedFiles"
        @onDone="onAddToAlbumDone"
      />
    </div>
  </SearchLayout>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { debounce, filter, findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { BulkDownloadService } from "~~/services/BulkDownloadService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import {
  buildDateFilters,
  filterLabels,
  parseBboxQuery,
  parsePlaceKey,
  placeKey,
  SORT_DEFAULT,
  SORT_OPTIONS,
} from "~~/utils/SearchFilters";
import { slideshowSourceFiles } from "~~/utils/Slideshow";

// Matches SEARCH_MAX_RESULTS on the server: the per-request maximum. More
// results are fetched explicitly with the "Load more" button.
const SEARCH_PAGE_SIZE = 5000;

function placeLabel(place) {
  return [place.city, place.region, place.country].filter(Boolean).join(", ");
}

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
      loadingMore: false,
      requestEtag: "",
      currentAccountId: "",
      initialAccountId: "",
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
      labelFilter: "",
      places: [],
      placeFilterKey: "",
      placeFilter: null,
      sort: SORT_DEFAULT,
      sortOptions: SORT_OPTIONS,
      bbox: null,
      total: 0,
      offset: 0,
      hasMore: false,
      pageSize: SEARCH_PAGE_SIZE,
      searchRequestId: 0,
      selectedFiles: [],
      displayFullScreen: false,
      positionFocus: 0,
      viewerFiles: [],
      slideshowMode: false,
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
    filteredLabels() {
      return filterLabels(this.labels, this.labelFilter);
    },
    // The place select lists the account's places, plus the deep-linked place
    // when it is not part of that list (e.g. before the places request lands).
    placeOptions() {
      const options = this.places.map((place) => ({
        key: placeKey(place),
        label: place.label,
        count: place.count,
      }));
      if (
        this.placeFilter &&
        !options.some((option) => option.key === this.placeFilterKey)
      ) {
        options.unshift({
          key: this.placeFilterKey,
          label: placeLabel(this.placeFilter),
          count: 0,
        });
      }
      return options;
    },
  },
  async created() {
    this.applyDeepLink(this.$route.query);
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
  },
  methods: {
    applyDeepLink(query) {
      if (!query) return;
      if (typeof query.accountId === "string" && query.accountId) {
        this.initialAccountId = query.accountId;
        this.currentAccountId = query.accountId;
      }
      if (typeof query.keywords === "string") {
        this.searchKeyword = query.keywords;
      }
      if (typeof query.dateFrom === "string") {
        this.dateFrom = query.dateFrom;
      }
      if (typeof query.dateTo === "string") {
        this.dateTo = query.dateTo;
      }
      if (typeof query.sort === "string") {
        this.sort = SORT_OPTIONS.some((option) => option.value === query.sort)
          ? query.sort
          : SORT_DEFAULT;
      }
      const place = {
        country: typeof query.placeCountry === "string" ? query.placeCountry : "",
        region: typeof query.placeRegion === "string" ? query.placeRegion : "",
        city: typeof query.placeCity === "string" ? query.placeCity : "",
      };
      if (place.city || place.region || place.country) {
        this.placeFilter = place;
        this.placeFilterKey = placeKey(place);
      }
      this.bbox = parseBboxQuery(query.bbox);
    },
    buildFilters() {
      const filters = {};
      if (this.searchKeyword.trim().length > 1) {
        filters.keywords = this.searchKeyword.trim();
      }
      Object.assign(filters, buildDateFilters(this.dateFrom, this.dateTo));
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
      if (this.placeFilter) {
        if (this.placeFilter.country) {
          filters.placeCountry = this.placeFilter.country;
        }
        if (this.placeFilter.region) {
          filters.placeRegion = this.placeFilter.region;
        }
        if (this.placeFilter.city) {
          filters.placeCity = this.placeFilter.city;
        }
      }
      if (this.bbox) {
        filters.geoBox = { ...this.bbox };
      }
      return filters;
    },
    clearBbox() {
      this.bbox = null;
      this.onSearchFilterChanged();
    },
    onPlaceChanged() {
      this.placeFilter = parsePlaceKey(this.placeFilterKey);
      this.onSearchFilterChanged();
    },
    async runSearch(append = false) {
      if (!this.currentAccountId) return;
      const filters = this.buildFilters();
      if (Object.keys(filters).length === 0) {
        this.files = [];
        this.selectedFiles = [];
        this.total = 0;
        this.offset = 0;
        this.hasMore = false;
        return;
      }
      this.searchRequestId += 1;
      const requestId = this.searchRequestId;
      if (append) {
        this.loadingMore = true;
      } else {
        this.loading = true;
        this.selectedFiles = [];
      }
      try {
        const res = await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search`,
          {
            filters,
            sort: this.sort,
            limit: SEARCH_PAGE_SIZE,
            offset: append ? this.offset : 0,
          },
          await AuthService.getAuthHeader(),
        );
        if (requestId !== this.searchRequestId) return;
        const files = res.data.files || [];
        this.files = append ? [...this.files, ...files] : files;
        this.total = Number(res.data.total ?? this.files.length);
        this.offset = Number(res.data.offset ?? 0) + files.length;
        this.hasMore = Boolean(res.data.hasMore);
      } catch (err) {
        handleError(err);
      } finally {
        if (requestId === this.searchRequestId) {
          this.loading = false;
          this.loadingMore = false;
        }
      }
    },
    loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore) return;
      this.runSearch(true);
    },
    onSearchFilterChanged: debounce(async function () {
      this.offset = 0;
      await this.runSearch(false);
    }, 500),
    async onAccountSelected(event) {
      this.currentAccountId = event.id;
      this.folderId = "";
      await Promise.all([this.fetchLabels(), this.fetchPlaces()]);
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
          this.labels = res.data.labels || [];
        })
        .catch(handleError);
    },
    async fetchPlaces() {
      this.places = [];
      if (!this.currentAccountId) return;
      await axios
        .get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search/places`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.places = res.data.places || [];
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
          this.fetchPlaces();
          this.onSearchFilterChanged();
        })
        .catch(handleError);
    },
    async clickedDownload() {
      if (this.bulkDownloading) return;
      this.bulkDownloading = true;
      try {
        await BulkDownloadService.downloadZip(
          this.currentAccountId,
          this.selectedFiles,
        );
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
    clickedAddToAlbum() {
      this.activeOperation = "add-to-album";
    },
    onAddToAlbumDone() {
      this.activeOperation = "";
      this.selectedFiles = [];
    },
    onMoveDone() {
      this.activeOperation = "";
      this.selectedFiles = [];
      this.fetchLabels();
      this.fetchPlaces();
      this.onSearchFilterChanged();
    },
    focusGalleryItem(file) {
      if (!file) {
        this.unFocusGalleryItem();
        return;
      }
      this.slideshowMode = false;
      this.viewerFiles = [];
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    clickedSlideshow() {
      const source = slideshowSourceFiles(this.files, this.selectedFiles);
      if (source.length === 0) {
        return;
      }
      this.viewerFiles = source;
      this.positionFocus = 0;
      this.slideshowMode = true;
      this.displayFullScreen = true;
    },
    unFocusGalleryItem(result) {
      this.displayFullScreen = false;
      this.slideshowMode = false;
      this.viewerFiles = [];
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
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.search-label-filter {
  margin: 0;
  width: 100%;
  max-width: 14em;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-sm);
}

.search-labels-empty {
  opacity: 0.7;
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

.search-results-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.search-results-header kbd {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-base);
}

.search-results-notice {
  opacity: 0.75;
}

.search-load-more {
  display: flex;
  justify-content: center;
  margin: var(--space-base) 0;
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
