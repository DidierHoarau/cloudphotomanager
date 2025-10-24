<template>
  <div class="search-gallery-layout page">
    <NavigationSearch
      class="search-gallery-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
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
      <div class="search-gallery-layout-dates">
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
    </div>

    <div class="analysis-items-actions actions"></div>
    <div class="analysis-item-list">
      <Loading v-if="loading" />
      <LazyGallery
        v-else
        :files="files"
        @focusGalleryItem="focusGalleryItem"
        @onFileSelected="onFileSelected"
        :selectedFiles="selectedFiles"
      />
    </div>
    <GalleryItemFocus
      v-if="displayFullScreen"
      :inputFiles="{ files, position: positionFocus }"
      class="gallery-item-focus"
      @onFileClosed="unFocusGalleryItem"
    />
  </div>
</template>

<script>
import axios from "axios";
import { debounce, filter, find, findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

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
      selectedFiles: [],
      displayFullScreen: false,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
  },
  methods: {
    onSearchFilterChanged: debounce(async function (e) {
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
      if (Object.keys(filters).length > 0) {
        this.loading = true;
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${
              this.currentAccountId
            }/files/search`,
            { filters },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            this.files = res.data.files;
            this.loading = false;
          })
          .catch(handleError);
      } else {
        this.files = [];
      }
    }, 500),
    onAccountSelected(event) {
      this.currentAccountId = event.id;
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
    focusGalleryItem(file) {
      console.log(file);
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
.search-gallery-layout {
  display: grid;
  grid-template-rows: auto auto 2.5em 1fr;
  grid-template-columns: 1fr;
  gap: 1em;
}

.search-gallery-layout-dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 1em;
}

@media (prefers-color-scheme: dark) {
  .source-active {
    background-color: #333;
  }
  .gallery-folders {
    background-color: #33333333;
  }
}
@media (prefers-color-scheme: light) {
  .source-active {
    background-color: #bbb;
  }
  .gallery-folders {
    background-color: #aaaaaa33;
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
.analysis-file-list-file {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr auto;
  margin-top: 0.5em;
  padding-top: 0.6em;
  padding-bottom: 0.6em;
  border-top: 1px solid #333333aa;
}
.analysis-file-list-file-name {
  word-break: break-all;
}
.analysis-file-list-file-actions i {
  padding-left: 0.9em;
  padding-right: 0.5em;
}
.analysis-item {
  margin-top: 1em;
}

.analysis-item-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1em;
}
</style>
