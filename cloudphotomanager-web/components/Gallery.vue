<template>
  <div class="gallery-file-list">
    <div class="card gallery-file" v-for="file in filterOuttakes(files)" v-bind:key="file.id">
      <div class="gallery-file-image" v-on:click="focusGalleryItem(file)">
        <i v-if="getType(file) == 'video'" class="bi bi-play-circle gallery-file-video-type-overlay"></i>
        <img
          :src="
            staticUrl + '/' + file.accountId + '/' + file.id[0] + '/' + file.id[1] + '/' + file.id + '/thumbnail.webp'
          "
          onerror="this.onerror=null; this.src='/images/file-sync-in-progress.webp'"
        />
      </div>
      <div class="gallery-file-selected">
        <input v-on:input="onFileSelected(file)" type="checkbox" :checked="isFileSelected(file)" />
      </div>
      <div class="gallery-file-name">
        {{ file.filename }}
      </div>
      <div class="gallery-file-date">{{ displayDate(file.dateMedia) }}</div>
      <div class="gallery-file-size">
        {{ displaySize(file.info.size) }}
      </div>
    </div>
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { find, findIndex, sortBy, filter } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { FileUtils } from "~~/services/FileUtils";

export default {
  props: {
    files: {
      type: Array,
      required: false,
      default: () => [],
    },
  },
  data() {
    return {
      menuOpened: true,
      serverUrl: "",
      staticUrl: "",
      selectedFile: null,
      selectedFiles: [],
      requestEtag: "",
      currentAccountId: "",
      currentFolderId: "",
      loading: false,
      activeOperation: "",
      displayFullScreen: false,
      positionFocus: 0,
      showOutakes: false,
      outtakesCount: 0,
    };
  },
  async created() {
    this.staticUrl = (await Config.get()).STATIC_URL;
  },
  methods: {
    filterOuttakes() {
      if (!this.showOutakes) {
        return filter(this.files, (file) => !file.isOuttake);
      }
      console.log(this.files);
      return this.files;
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
    onFileSelected(file) {
      const selectedIndex = findIndex(this.selectedFiles, { id: file.id });
      if (selectedIndex < 0) {
        this.selectedFiles.push(file);
      } else {
        this.selectedFiles.splice(selectedIndex, 1);
      }
    },
    isFileSelected(file) {
      return findIndex(this.selectedFiles, { id: file.id }) >= 0;
    },
    onFolderSelected(event) {
      useRouter().push({ query: { accountId: event.folder.accountId, folderId: event.folder.id } });
      this.fetchFiles(event.folder.accountId, event.folder.id);
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
      useRouter().push({ query: { accountId: this.currentAccountId, folderId: this.currentFolderId } });
      this.displayFullScreen = false;
      if (result.status === "invalidated") {
        this.fetchFiles(this.currentAccountId, this.currentFolderId);
      }
    },
    openListMenu() {
      this.menuOpened = !this.menuOpened;
    },
    displayDate(date) {
      if (!date || new Date(date).getTime() === 0) {
        return "";
      }
      return new Date(date).toLocaleString();
    },
    displaySize(size) {
      if (!size) {
        return "";
      }
      try {
        if (size > 1000000000) {
          return (Number(size) / 1000000000).toFixed(1) + " GB";
        }
        if (size > 1000000) {
          return (Number(size) / 1000000).toFixed(1) + " MB";
        }
        if (size > 1000) {
          return (Number(size) / 1000).toFixed(1) + " KB";
        }
        return size + " B";
      } catch (err) {
        return "";
      }
    },
    onDialogClosed(result) {
      this.activeOperation = "";
      if (result && result.status === "invalidated") {
        this.selectedFiles = [];
      }
    },
    onOperationDone(result) {
      this.selectedFiles = [];
      this.activeOperation = "";
      EventBus.emit(EventTypes.FOLDER_UPDATED, {});
      EventBus.emit(EventTypes.FILE_UPDATED, {});
      this.clickedRefresh();
    },
    clickedMove() {
      this.activeOperation = "move";
    },
    clickedSelect() {
      this.activeOperation = "select";
    },
    clickedAdvanced() {
      this.activeOperation = "advanced";
    },
    async clickedDelete() {
      let message = `Delete the ${this.selectedFiles.length} selected files? (Can't be undone!)\n`;
      if (this.selectedFiles.length === 1) {
        message = `Delete the file? (Can't be undone!)\nFile: ${this.selectedFiles[0].filename} \n`;
      }
      if (confirm(message) == true) {
        this.loading = true;
        SyncStore().markOperationInProgress();
        const fileIdList = [];
        for (const file of this.selectedFiles) {
          fileIdList.push(file.id);
        }
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${this.currentAccountId}/files/batch/operations/fileDelete`,
            {
              fileIdList,
            },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "File deleted",
            });
            this.onOperationDone({ status: "invalidated" });
          })
          .catch(handleError);

        this.loading = false;
      }
    },
    async clickedDeleteFolder() {
      let message = `Delete the current Folder? (Can't be undone!)\n`;
      const parentFolderId = FoldersStore().getParentFolder(this.folder).id;
      if (confirm(message) == true) {
        this.loading = true;
        SyncStore().markOperationInProgress();
        axios
          .delete(
            `${(await Config.get()).SERVER_URL}/accounts/${this.folder.accountId}/folders/${
              this.folder.id
            }/operations/delete`,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "Folder deleted",
            });
            this.onOperationDone({ status: "invalidated" });
            FoldersStore().fetch();
            useRouter().push({
              path: "/gallery",
              query: { accountId: this.folder.accountId, folderId: parentFolderId },
            });
          })
          .catch(handleError);
        this.loading = false;
      }
    },
    getType(file) {
      return FileUtils.getType(file);
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
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto auto;
  height: 11em;
}
.gallery-file-name {
  grid-row: 2;
  grid-column-start: 2;
  grid-column-end: span 2;
  font-size: 0.7em;
  word-break: break-all;
  opacity: 0.8;
}
.gallery-file-image {
  grid-row: 1;
  grid-column-start: 1;
  grid-column-end: span 3;
  word-break: break-all;
  position: relative;
}
.gallery-file-image img {
  width: 100%;
  height: 8em;
  object-fit: cover;
}
.gallery-file-date {
  height: 2em;
  grid-column: 2;
  grid-row: 3;
  font-size: 0.6em;
  word-break: break-all;
  opacity: 0.4;
}
.gallery-file-size {
  height: 2em;
  grid-column: 3;
  grid-row: 3;
  font-size: 0.6em;
  word-break: break-all;
  opacity: 0.4;
}
.gallery-file-selected {
  grid-column: 1;
  grid-row-start: 2;
  grid-row-end: span 2;
  padding-right: 0.3em;
}

.gallery-files-actions {
  padding-bottom: 0.3em;
}
.gallery-files-actions button,
.gallery-files-actions kbd {
  padding: 0.3em 0.7em;
  font-size: 0.8em;
}

.gallery-files-actions kbd {
  height: 2.2em;
}

.gallery-layout {
  display: grid;
  grid-template-rows: 1fr auto 2fr;
  grid-template-columns: 1fr;
  column-gap: 1em;
}
.gallery-files-actions {
  padding-top: 0.5em;
  grid-row: 2;
  grid-column-start: 1;
  grid-column-end: span 2;
}
.gallery-file-list {
  overflow: auto;
}
.gallery-folders {
  overflow: auto;
  height: 30vh;
  grid-row: 1;
  grid-column-start: 1;
  grid-column-end: span 2;
}
.gallery-folders-closed {
  height: 0px !important;
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
.gallery-file-video-type-overlay {
  font-size: 3em;
  position: absolute;
  right: 0.1em;
  bottom: 0em;
  opacity: 0.5;
}

.gallery-files-actions kbd {
  margin-right: 1em;
}

.option-outtakes {
  opacity: 30%;
  font-size: 0.8em;
}
.option-outtakes input {
  height: 1em;
  width: 1em;
}
.option-outtakes label {
  display: inline;
}
</style>
