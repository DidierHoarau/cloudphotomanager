<template>
  <div class="gallery-layout page">
    <div class="gallery-layout-actions actions">
      <kbd v-if="syncStore.countTotal > 0">Sync: {{ syncStore.countTotal }}</kbd>
    </div>
    <div class="gallery-folders" :class="{ 'gallery-folders-closed': !menuOpened }">
      <FolderList @onFolderSelected="onFolderSelected" />
    </div>
    <div class="gallery-files-actions actions-secondary">
      <span v-if="currentFolderId" v-on:click="clickedRefresh()"> <i class="bi bi-arrow-clockwise"></i> Refresh </span>
    </div>
    <div class="gallery-file-list">
      <Loading v-if="loadding" />
      <div class="card gallery-file" v-on:click="selectGalleryFile(file)" v-for="file in files" v-bind:key="file.id">
        <div class="gallery-file-image">
          <img
            :src="serverUrl + '/accounts/' + file.accountId + '/files/' + file.id + '/thumbnail'"
            onerror="this.onerror=null; this.src='/images/file-sync-in-progress.webp'"
          />
        </div>
        <div class="gallery-file-name">
          {{ file.filename }}
        </div>
        <div class="gallery-file-info">
          {{ relativeTime(file.dateMedia) }}
        </div>
      </div>
    </div>
    <GalleryItemFocus
      v-if="selectedFile"
      :file="selectedFile"
      class="gallery-item-focus"
      @onFileClosed="unselectGalleryFile"
    />
  </div>
</template>

<script setup>
const syncStore = SyncStore();
</script>

<script>
import axios from "axios";
import * as _ from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      files: [],
      menuOpened: true,
      serverUrl: "",
      selectedFile: null,
      requestEtag: "",
      currentAccountId: "",
      currentFolderId: "",
      loadding: false,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
    SyncStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      FoldersStore().fetch();
    }
    EventBus.on(EventTypes.FOLDER_UPDATED, (message) => {
      FoldersStore().fetch();
    });
    EventBus.on(EventTypes.FILE_UPDATED, (message) => {
      FoldersStore().fetch();
    });
    EventBus.on(EventTypes.FOLDER_SELECTED, (message) => {
      this.fetchFiles(message.accountId, message.folderId, true);
    });
  },
  methods: {
    async fetchFiles(accountId, folderId, forceLoading = false) {
      const requestEtag = new Date().toISOString();
      if (forceLoading || this.currentAccountId !== accountId || this.currentFolderId !== folderId) {
        this.currentAccountId = accountId;
        this.currentFolderId = folderId;
        this.files = [];
        this.loadding = true;
      }
      this.requestEtag = requestEtag;
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/${accountId}/folders/${folderId}/files`,
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          if (this.requestEtag === requestEtag) {
            this.files = _.sortBy(res.data.files, ["name"]);
          }
        })
        .catch(handleError)
        .finally(() => {
          this.requestEtag = "";
          this.loadding = false;
        });
    },
    async clickedRefresh() {
      await axios
        .put(
          `${(await Config.get()).SERVER_URL}/accounts/${this.currentAccountId}/folders/${this.currentFolderId}/sync`,
          {},
          await AuthService.getAuthHeader()
        )
        .catch(handleError);
      this.fetchFiles(this.currentAccountId, this.currentFolderId, true);
      EventBus.emit(EventTypes.FOLDER_UPDATED, {});
      EventBus.emit(EventTypes.FILE_UPDATED, {});
    },
    onFolderSelected(event) {
      this.fetchFiles(event.folder.accountId, event.folder.id);
    },
    selectGalleryFile(file) {
      this.selectedFile = file;
    },
    unselectGalleryFile(result) {
      this.selectedFile = null;
      if (result.status === "invalidated") {
        this.fetchFiles(this.currentAccountId, this.currentFolderId);
      }
    },
    openListMenu() {
      this.menuOpened = !this.menuOpened;
    },
    relativeTime(date) {
      if (!date || new Date(date).getTime() === 0) {
        return "";
      }
      return new Date(date).toLocaleString();
    },
  },
};
</script>

<style scoped>
.gallery-file-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: 1em;
}
.gallery-file {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto auto;
  height: 11em;
}
.gallery-file-name {
  grid-row: 2;
  font-size: 0.7em;
  word-break: break-all;
  opacity: 0.8;
}
.gallery-file-image {
  grid-row: 1;
  word-break: break-all;
}
.gallery-file-image img {
  width: 100%;
  height: 8em;
  object-fit: cover;
}
.gallery-file-info {
  height: 2em;
  grid-row: 3;
  font-size: 0.6em;
  word-break: break-all;
  opacity: 0.4;
}

@media (min-width: 701px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: 2.5em 2.5em 1fr;
    grid-template-columns: auto 1fr 1fr;
    column-gap: 1em;
  }
  .gallery-layout-actions {
    grid-column-start: 1;
    grid-column-end: span 3;
    grid-row-start: 1;
  }
  .gallery-files-actions {
    padding-top: 0.5em;
    grid-row: 2;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .gallery-file-list {
    overflow: auto;
    grid-row: 3;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .gallery-header {
    grid-row: 1;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders {
    width: 30vw;
    max-width: 20em;
    overflow: auto;
    height: auto;
    grid-row-start: 2;
    grid-row-end: span 2;
    grid-column: 1;
  }
  .gallery-layout-actions-menu-toggle {
    visibility: hidden;
    font-size: 0px;
    padding: 0px;
    margin: 0px;
  }
}

@media (max-width: 700px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: 2.5em 1fr 2.5em 2fr;
    grid-template-columns: 1fr;
    column-gap: 1em;
  }
  .gallery-layout-actions {
    grid-column: 1;
    grid-row: 1;
  }
  .gallery-files-actions {
    padding-top: 0.5em;
    grid-row: 3;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-file-list {
    overflow: auto;
    grid-row: 4;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders {
    overflow: auto;
    height: 30vh;
    grid-row: 2;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders-closed {
    height: 0px !important;
  }
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
</style>
