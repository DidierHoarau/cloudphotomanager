<template>
  <div class="gallery-layout page">
    <div class="gallery-folders-mobile-wrapper">
      <button class="gallery-folders-toggle" @click="openListMenu">
        <span>Folders</span>
        <i :class="menuOpened ? 'bi bi-chevron-up' : 'bi bi-chevron-down'"></i>
      </button>
      <div
        class="gallery-folders"
        :class="{ 'gallery-folders-closed': !menuOpened }"
      >
        <FolderList monitorRoute="true" @onFolderSelected="onFolderSelected" />
      </div>
    </div>
    <div class="gallery-files-actions">
      <button class="secondary outline" v-on:click="clickedRefresh()">
        <i class="bi bi-arrow-clockwise"></i> Refresh
      </button>
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
        v-on:click="clickedDelete()"
      >
        <i class="bi bi-trash-fill"></i> Delete
      </button>
      <button
        v-if="
          files.length == 0 &&
          folder.children == 0 &&
          folder.parentIndex >= 0 &&
          authenticationStore.isAdmin
        "
        class="secondary outline"
        v-on:click="clickedDeleteFolder()"
      >
        <i class="bi bi-trash-fill"></i> Del. Folder
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
        v-on:click="clickedAdvanced()"
      >
        <i class="bi bi-three-dots"></i> More...
      </button>
      <button class="secondary outline" v-on:click="clickedOptions()">
        <i class="bi bi-sliders"></i> Options...
      </button>
      <span class="option-outtakes" v-if="outtakesCount > 0">
        <label>
          <input v-model="showOutakes" type="checkbox" /> OutTakes ({{
            outtakesCount
          }})
        </label></span
      >
    </div>
    <div class="gallery-file-list">
      <Loading v-if="loading" />
      <template v-else>
        <Gallery
          :files="filterOuttakes(files)"
          @focusGalleryItem="focusGalleryItem"
          @onFileSelected="onFileSelected"
          :selectedFiles="selectedFiles"
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
      @onFileClosed="unFocusGalleryItem"
      @onFileSelected="onFileSelected"
    />
    <DialogConfirm
      v-if="activeOperation == 'confirm-delete'"
      title="Delete Files"
      :message="confirmMessage"
      @onConfirm="executeDelete"
      @onCancel="activeOperation = ''"
    />
    <DialogConfirm
      v-if="activeOperation == 'confirm-delete-folder'"
      title="Delete Folder"
      :message="confirmMessage"
      @onConfirm="executeDeleteFolder"
      @onCancel="activeOperation = ''"
    />
    <DialogMove
      v-if="activeOperation == 'move'"
      :files="selectedFiles"
      @onDone="onOperationDone"
    />
    <DialogSelect
      v-if="activeOperation == 'select'"
      :selectedFiles="selectedFiles"
      :files="files"
      @onDone="onDialogClosed"
    />
    <DialogAdvanced
      v-if="activeOperation == 'advanced'"
      :selectedFiles="selectedFiles"
      :files="selectedFiles"
      @onDone="onDialogClosed"
    />
    <DialogGalleryOptions
      v-if="activeOperation == 'options'"
      :includeSubFolders="includeSubFolders"
      :sortOrder="sortOrder"
      @onSave="onOptionsSaved"
      @onClose="activeOperation = ''"
    />
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { find, findIndex, filter } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { FileUtils } from "~~/services/FileUtils";

export default {
  data() {
    return {
      folder: {},
      files: [],
      menuOpened: (() => {
        try {
          const saved = localStorage.getItem("galleryFolderListOpen");
          if (saved !== null) return saved === "true";
        } catch (e) {
          /* ignore */
        }
        return true;
      })(),
      serverUrl: "",
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
      includeSubFolders: false,
      sortOrder: "desc",
      currentPage: 0,
      pageSize: 60,
      hasMore: false,
      loadingMore: false,
      observer: null,
      _onFolderUpdated: null,
      _onFileUpdated: null,
      _onFolderSelected: null,
      _onOperationComplete: null,
      _onFolderCacheUpdated: null,
      confirmMessage: "",
      _pendingDeleteFolderParentId: "",
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    try {
      const saved = localStorage.getItem("galleryOptions");
      if (saved) {
        const o = JSON.parse(saved);
        if (typeof o.includeSubFolders === "boolean") {
          this.includeSubFolders = o.includeSubFolders;
        }
        if (o.sortOrder === "asc" || o.sortOrder === "desc") {
          this.sortOrder = o.sortOrder;
        }
      }
    } catch (e) {
      // ignore
    }
    await AccountsStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      await FoldersStore().fetch();
    }
    this._onFolderUpdated = (message) => {
      if (
        message.accountId === this.currentAccountId &&
        message.folderId === this.currentFolderId
      ) {
        this.fetchFiles(message.accountId, message.folderId, true);
      }
    };
    this._onFileUpdated = () => {
      // folder list refreshed by FOLDER_CACHE_UPDATED from server
    };
    this._onFolderSelected = (message) => {
      this.fetchFiles(message.accountId, message.folderId, true);
    };
    this._onFolderCacheUpdated = () => {
      FoldersStore().fetch();
    };
    this._onOperationComplete = (message) => {
      if (!this.currentAccountId || !this.currentFolderId) return;
      const affectedFileIds = message?.fileIds || [];
      const operationName = message?.operationName || "";

      // File removal operations: update local array without full refresh
      if (
        (operationName === "fileDelete" || operationName === "folderMove") &&
        affectedFileIds.length > 0
      ) {
        const removedSet = new Set(affectedFileIds);
        this.files = this.files.filter((f) => !removedSet.has(f.id));
        this.selectedFiles = this.selectedFiles.filter(
          (f) => !removedSet.has(f.id),
        );
        this.outtakesCount = this.files.filter((f) => f.isOuttake).length;
        return;
      }

      // Filename changes or folder-level sync: silent refresh (no loading flash)
      if (
        operationName === "fileRename" ||
        operationName === "SyncInventorySyncFolder"
      ) {
        this.fetchFilesSilent();
        return;
      }

      // Thumbnail/preview operations: silent refresh only if affected files visible
      const refreshIfVisibleOps = [
        "syncThumbnail",
        "syncThumbnailFromVideoPreview",
        "syncPhotoFromFull",
        "syncVideoFromFull",
      ];
      if (
        refreshIfVisibleOps.includes(operationName) &&
        affectedFileIds.some((id) => this.files.some((f) => f.id === id))
      ) {
        this.fetchFilesSilent();
      }
    };
    EventBus.on(EventTypes.FOLDER_UPDATED, this._onFolderUpdated);
    EventBus.on(EventTypes.FILE_UPDATED, this._onFileUpdated);
    EventBus.on(EventTypes.FOLDER_SELECTED, this._onFolderSelected);
    EventBus.on(EventTypes.FOLDER_CACHE_UPDATED, this._onFolderCacheUpdated);
    EventBus.on(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
    if (
      useRoute().query.accountId &&
      useRoute().query.folderId &&
      useRoute().query.fileId
    ) {
      await this.fetchFiles(
        useRoute().query.accountId,
        useRoute().query.folderId,
      );
      this.focusGalleryItem(find(this.files, { id: useRoute().query.fileId }));
    } else if (useRoute().query.accountId && useRoute().query.folderId) {
      this.fetchFiles(useRoute().query.accountId, useRoute().query.folderId);
    } else {
      const firstRoot = FoldersStore().folders.find(
        (f) => f.parentIndex === -1,
      );
      if (firstRoot) {
        useRouter().replace({
          query: { accountId: firstRoot.accountId, folderId: firstRoot.id },
        });
      }
    }
    watch(
      () => useRoute().query.folderId,
      () => {
        if (this.currentFolderId !== useRoute().query.folderId) {
          this.displayFullScreen = false;
          this.fetchFiles(
            useRoute().query.accountId,
            useRoute().query.folderId,
          );
        }
      },
    );
    watch(
      () => useRoute().query.fileId,
      () => {
        setTimeout(async () => {
          if (useRoute().query.fileId) {
            if (!this.displayFullScreen) {
              await this.fetchFiles(
                useRoute().query.accountId,
                useRoute().query.folderId,
              );
            }
            this.focusGalleryItem(
              find(this.files, { id: useRoute().query.fileId }),
            );
          } else {
            this.displayFullScreen = false;
          }
        }, 500);
      },
    );
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
    EventBus.off(EventTypes.FOLDER_UPDATED, this._onFolderUpdated);
    EventBus.off(EventTypes.FILE_UPDATED, this._onFileUpdated);
    EventBus.off(EventTypes.FOLDER_SELECTED, this._onFolderSelected);
    EventBus.off(EventTypes.FOLDER_CACHE_UPDATED, this._onFolderCacheUpdated);
    EventBus.off(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
  },
  methods: {
    filterOuttakes(files) {
      if (!this.showOutakes) {
        return filter(files, { isOuttake: false });
      }
      return files;
    },
    async fetchFiles(accountId, folderId, forceLoading = false) {
      const requestEtag = new Date().toISOString();
      if (
        forceLoading ||
        this.currentAccountId !== accountId ||
        this.currentFolderId !== folderId
      ) {
        this.currentAccountId = accountId;
        this.currentFolderId = folderId;
        this.files = [];
        this.currentPage = 0;
        this.hasMore = false;
        this.loading = true;
      }
      this.requestEtag = requestEtag;
      const serverUrl = (await Config.get()).SERVER_URL;
      const params = new URLSearchParams({
        includeSubFolders: String(this.includeSubFolders),
        sortOrder: this.sortOrder,
        page: "0",
        pageSize: String(this.pageSize),
      });
      await axios
        .get(
          `${serverUrl}/accounts/${accountId}/folders/${folderId}/files-recursive?${params}`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.outtakesCount = 0;
          if (this.requestEtag === requestEtag) {
            const newFiles = res.data.files || [];
            for (const file of newFiles) {
              file.isOuttake = false;
              if (file.filename.indexOf("-outtake.") > 0) {
                file.isOuttake = true;
                this.outtakesCount++;
              }
            }
            this.files = newFiles;
            this.currentPage = 0;
            this.hasMore =
              res.data.total > (this.currentPage + 1) * this.pageSize;
          }
        })
        .catch(handleError)
        .finally(() => {
          this.requestEtag = "";
          this.loading = false;
        });
      this.folder = find(FoldersStore().folders, { id: folderId }) || {};
    },
    async loadMoreFiles() {
      if (!this.hasMore || this.loadingMore || this.loading) {
        return;
      }
      this.loadingMore = true;
      const nextPage = this.currentPage + 1;
      const serverUrl = (await Config.get()).SERVER_URL;
      const params = new URLSearchParams({
        includeSubFolders: String(this.includeSubFolders),
        sortOrder: this.sortOrder,
        page: String(nextPage),
        pageSize: String(this.pageSize),
      });
      await axios
        .get(
          `${serverUrl}/accounts/${this.currentAccountId}/folders/${this.currentFolderId}/files-recursive?${params}`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          const newFiles = res.data.files || [];
          for (const file of newFiles) {
            file.isOuttake = false;
            if (file.filename.indexOf("-outtake.") > 0) {
              file.isOuttake = true;
              this.outtakesCount++;
            }
          }
          this.files = [...this.files, ...newFiles];
          this.currentPage = nextPage;
          this.hasMore = res.data.total > (nextPage + 1) * this.pageSize;
        })
        .catch(handleError)
        .finally(() => {
          this.loadingMore = false;
        });
    },
    async fetchFilesSilent() {
      if (!this.currentAccountId || !this.currentFolderId) return;
      const serverUrl = (await Config.get()).SERVER_URL;
      const totalToFetch = Math.max(
        this.pageSize,
        (this.currentPage + 1) * this.pageSize,
      );
      const params = new URLSearchParams({
        includeSubFolders: String(this.includeSubFolders),
        sortOrder: this.sortOrder,
        page: "0",
        pageSize: String(totalToFetch),
      });
      try {
        const res = await axios.get(
          `${serverUrl}/accounts/${this.currentAccountId}/folders/${this.currentFolderId}/files-recursive?${params}`,
          await AuthService.getAuthHeader(),
        );
        const newFiles = res.data.files || [];
        let outtakesCount = 0;
        for (const file of newFiles) {
          file.isOuttake = file.filename.indexOf("-outtake.") > 0;
          if (file.isOuttake) outtakesCount++;
        }
        this.files = newFiles;
        this.outtakesCount = outtakesCount;
        this.hasMore = res.data.total > totalToFetch;
      } catch (err) {
        handleError(err);
      }
    },
    async clickedRefresh() {
      await axios
        .put(
          `${(await Config.get()).SERVER_URL}/accounts/${
            this.currentAccountId
          }/folders/${this.currentFolderId}/sync`,
          {},
          await AuthService.getAuthHeader(),
        )
        .catch(handleError);
      this.fetchFiles(this.currentAccountId, this.currentFolderId, true);
      EventBus.emit(EventTypes.FOLDER_UPDATED, {});
    },
    onFileSelected(file) {
      const selectedIndex = findIndex(this.selectedFiles, { id: file.id });
      if (selectedIndex < 0) {
        this.selectedFiles.push(file);
      } else {
        this.selectedFiles.splice(selectedIndex, 1);
      }
    },
    onFolderSelected(event) {
      useRouter().push({
        query: { accountId: event.folder.accountId, folderId: event.folder.id },
      });
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
    unFocusGalleryItem() {
      useRouter().push({
        query: {
          accountId: this.currentAccountId,
          folderId: this.currentFolderId,
        },
      });
      this.displayFullScreen = false;
    },
    openListMenu() {
      this.menuOpened = !this.menuOpened;
      try {
        localStorage.setItem("galleryFolderListOpen", String(this.menuOpened));
      } catch (e) {
        /* ignore */
      }
    },
    onDialogClosed(result) {
      this.activeOperation = "";
      if (result && result.status === "invalidated") {
        this.selectedFiles = [];
      }
    },
    onOperationDone() {
      this.selectedFiles = [];
      this.activeOperation = "";
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
    clickedOptions() {
      this.activeOperation = "options";
    },
    onOptionsSaved(options) {
      this.includeSubFolders = options.includeSubFolders;
      this.sortOrder = options.sortOrder;
      try {
        localStorage.setItem(
          "galleryOptions",
          JSON.stringify({
            includeSubFolders: this.includeSubFolders,
            sortOrder: this.sortOrder,
          }),
        );
      } catch (e) {
        // ignore
      }
      this.activeOperation = "";
      if (this.currentAccountId && this.currentFolderId) {
        this.fetchFiles(this.currentAccountId, this.currentFolderId, true);
      }
    },
    clickedDelete() {
      if (this.selectedFiles.length === 1) {
        this.confirmMessage = `Delete the file? (Can't be undone!)\nFile: ${this.selectedFiles[0].filename}`;
      } else {
        this.confirmMessage = `Delete the ${this.selectedFiles.length} selected files? (Can't be undone!)`;
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
          `${(await Config.get()).SERVER_URL}/accounts/${
            this.currentAccountId
          }/files/batch/operations/fileDelete`,
          {
            fileIdList,
          },
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          this.selectedFiles = [];
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            text: "Delete queued — running in background",
          });
        })
        .catch(handleError);
    },
    clickedDeleteFolder() {
      this.confirmMessage = `Delete the current Folder? (Can't be undone!)`;
      this._pendingDeleteFolderParentId = FoldersStore().getParentFolder(
        this.folder,
      ).id;
      this.activeOperation = "confirm-delete-folder";
    },
    async executeDeleteFolder() {
      this.activeOperation = "";
      const parentFolderId = this._pendingDeleteFolderParentId;
      this.loading = true;
      SyncStore().markOperationInProgress();
      await axios
        .delete(
          `${(await Config.get()).SERVER_URL}/accounts/${
            this.folder.accountId
          }/folders/${this.folder.id}/operations/delete`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            text: "Folder deleted",
          });
          this.onOperationDone({ status: "invalidated" });
          useRouter().push({
            path: "/gallery",
            query: {
              accountId: this.folder.accountId,
              folderId: parentFolderId,
            },
          });
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
        });
    },
  },
};
</script>

<style scoped>
.gallery-files-actions {
  padding-bottom: 0.3em;
}
.gallery-files-actions button,
.gallery-files-actions kbd {
  padding: 0.3em 0.7em;
  margin-right: 0.5em;
  font-size: 0.8em;
}

.gallery-files-actions kbd {
  height: 2.2em;
}

@media (min-width: 901px) {
  .gallery-folders-mobile-wrapper {
    display: contents;
  }
  .gallery-folders-toggle {
    display: none;
  }
  .gallery-layout {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: auto 1fr 1fr;
    column-gap: 1em;
    overflow: hidden;
  }
  .gallery-files-actions {
    padding-top: 0.5em;
    grid-row: 1;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .gallery-file-list {
    overflow: auto;
    grid-row: 2;
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
    grid-row-start: 1;
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

@media (max-width: 900px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: auto auto 1fr;
    grid-template-columns: 1fr;
    column-gap: 1em;
    overflow: hidden;
  }
  .gallery-folders-mobile-wrapper {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .gallery-folders-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5em 0.75em;
    font-size: 0.85em;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    border: 1px solid transparent;
    border-radius: 0.4em;
    opacity: 0.85;
    box-sizing: border-box;
    margin: 0;
    transition:
      opacity 0.2s ease,
      background-color 0.2s ease,
      border-color 0.2s ease;
  }
  .gallery-folders-toggle:hover {
    opacity: 1;
  }
  .gallery-folders-toggle:active {
    opacity: 0.95;
  }
  .gallery-folders-toggle i {
    transition: transform 0.3s ease;
    font-size: 1em;
  }
  .gallery-files-actions {
    padding-top: 0.5em;
    grid-row: 2;
    grid-column: 1;
  }
  .gallery-file-list {
    overflow: auto;
    grid-row: 3;
    grid-column: 1;
  }
  .gallery-folders {
    overflow: auto;
    height: 25vh;
    transition:
      height 0.3s ease,
      opacity 0.3s ease;
    opacity: 1;
  }
  .gallery-folders-closed {
    height: 0px !important;
    opacity: 0;
    overflow: hidden;
  }
}

@media (prefers-color-scheme: dark) {
  .source-active {
    background-color: #333;
  }
  .gallery-folders-toggle {
    background-color: #4a4a4a55;
    border-color: #6a6a6a66;
  }
  .gallery-folders-toggle:hover {
    background-color: #5a5a5a66;
  }
  .gallery-folders {
    background-color: #33333333;
  }
}
@media (prefers-color-scheme: light) {
  .source-active {
    background-color: #bbb;
  }
  .gallery-folders-toggle {
    background-color: #bdbdbd4d;
    border-color: #a0a0a066;
  }
  .gallery-folders-toggle:hover {
    background-color: #b0b0b066;
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
.sentinel {
  height: 1px;
  width: 100%;
}
</style>
