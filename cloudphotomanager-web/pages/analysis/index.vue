<template>
  <div class="gallery-layout page">
    <div class="gallery-layout-actions actions">
      <kbd v-if="syncStore.countTotal > 0">Sync: {{ syncStore.countTotal }}</kbd>
    </div>
    <div class="analysis-items-actions actions"></div>
    <div class="analysis-item-list">
      <Loading v-if="requestEtag" />
      <div class="card analysis-item" v-for="item in analysis" v-bind:key="item.hash">
        <div class="analysis-item-image">
          <img
            :src="serverUrl + '/accounts/' + item.files[0].accountId + '/files/' + item.files[0].id + '/thumbnail'"
            onerror="this.onerror=null; this.src='/images/file-sync-in-progress.webp'"
          />
        </div>
        <div class="analysis-file-list">
          <div class="analysis-file-file" v-for="file in item.files" v-bind:key="file.id">
            <div>{{ displayFolderPath(item.folders, file.folderId) }}</div>
          </div>
        </div>
        <!-- <div class="analysis-item-name">
          {{ file.filename }}
        </div>
        <div class="analysis-item-info">
          {{ relativeTime(file.dateMedia) }}
        </div> -->
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
      analysis: [],
      menuOpened: true,
      serverUrl: "",
      selectedFile: null,
      requestEtag: "",
      currentAccountId: "",
      currentFolderId: "",
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
    SyncStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      FoldersStore().fetch();
      this.fetchFiles(AccountsStore().accounts[0]);
    }
    EventBus.on(EventTypes.FOLDER_SELECTED, (message) => {
      this.fetchFiles(message.accountId, message.folderId);
    });
  },
  methods: {
    async fetchFiles(accountId) {
      const requestEtag = new Date().toISOString();
      this.requestEtag = requestEtag;
      this.analysis = [];
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/${accountId}/analysis/duplicates`,
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          if (this.requestEtag === requestEtag) {
            this.analysis = res.data.duplicates;
          }
        })
        .finally(() => {
          this.requestEtag = "";
        })
        .catch(handleError);
    },
    displayFolderPath(folders, folderId) {
      return _.find(folders, { id: folderId }).folderpath;
    },
    onFolderSelected(event) {
      this.fetchFiles(event.folder.accountId, event.folder.id);
    },
    selectGalleryFile(file) {
      this.selectedFile = file;
    },
    unselectGalleryFile(result) {
      this.selectedFile = null;
      console.log(result, "gallery");
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
.analysis-item-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1em;
}
.analysis-item {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto auto;
}
.analysis-item-name {
  grid-row: 2;
  font-size: 0.7em;
  word-break: break-all;
  opacity: 0.8;
}
.analysis-item-image {
  grid-row: 1;
  word-break: break-all;
}
.analysis-item-image img {
  height: 10em;
  object-fit: cover;
}
.analysis-item-info {
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
    grid-template-columns: auto 1fr;
    column-gap: 1em;
  }
  .gallery-layout-actions {
    grid-column-start: 1;
    grid-column-end: span 3;
    grid-row-start: 1;
  }
  .analysis-items-actions {
    grid-row: 2;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .analysis-item-list {
    overflow: auto;
    grid-row: 3;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-header {
    grid-row: 1;
    grid-column-start: 1;
    grid-column-end: span 2;
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
    grid-template-rows: 2.5em 2.5em 1fr;
    grid-template-columns: 1fr;
    column-gap: 1em;
  }
  .gallery-layout-actions {
    grid-column: 1;
    grid-row: 1;
  }
  .analysis-items-actions {
    grid-row: 3;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .analysis-item-list {
    overflow: auto;
    grid-row: 3;
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
