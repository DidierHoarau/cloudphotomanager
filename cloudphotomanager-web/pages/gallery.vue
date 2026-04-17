<template>
  <div class="gallery-layout page">
    <div
      class="gallery-folders"
      :class="{ 'gallery-folders-closed': !menuOpened }"
    >
      <FolderList monitorRoute="true" @onFolderSelected="onFolderSelected" />
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
      :inputFiles="{ files, position: positionFocus }"
      class="gallery-item-focus"
      @onFileClosed="unFocusGalleryItem"
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
    <DialogConfirm
      v-if="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @onConfirm="onConfirmDialog"
      @onCancel="showConfirmDialog = false"
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

export default {
  data() {
    return {
      folder: {},
      files: [],
      menuOpened: true,
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
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
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
        FoldersStore().fetch();
      }
    };
    this._onFileUpdated = () => {
      FoldersStore().fetch();
    };
    this._onFolderSelected = (message) => {
      this.fetchFiles(message.accountId, message.folderId, true);
    };
    this._onOperationComplete = (message) => {
      // Only refresh if the operation is relevant to the currently displayed folder
      if (this.currentAccountId && this.currentFolderId) {
        const affectedFileIds = message?.fileIds || [];
        const operationName = message?.operationName || "";
        // For moves, we can't know the destination folder, so always refresh
        const isMove = operationName === "folderMove";
        const affectsCurrentView =
          isMove ||
          affectedFileIds.length === 0 ||
          affectedFileIds.some((id) => this.files.some((f) => f.id === id));
        if (affectsCurrentView) {
          this.fetchFiles(this.currentAccountId, this.currentFolderId, true);
          FoldersStore().fetch();
        }
      }
      this.selectedFiles = [];
    };
    EventBus.on(EventTypes.FOLDER_UPDATED, this._onFolderUpdated);
    EventBus.on(EventTypes.FILE_UPDATED, this._onFileUpdated);
    EventBus.on(EventTypes.FOLDER_SELECTED, this._onFolderSelected);
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
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    unFocusGalleryItem(result) {
      useRouter().push({
        query: {
          accountId: this.currentAccountId,
          folderId: this.currentFolderId,
        },
      });
      this.displayFullScreen = false;
      if (result.status === "invalidated") {
        this.fetchFiles(this.currentAccountId, this.currentFolderId);
      }
    },
    openListMenu() {
      this.menuOpened = !this.menuOpened;
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
    async clickedDelete() {
      let message = `Delete the ${this.selectedFiles.length} selected files? (Can't be undone!)\n`;
      if (this.selectedFiles.length === 1) {
        message = `Delete the file? (Can't be undone!)\nFile: ${this.selectedFiles[0].filename} \n`;
      }
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = message;
      this.confirmDialogCallback = async () => {
        SyncStore().markOperationInProgress();
        const fileIdList = [];
        for (const file of this.selectedFiles) {
          fileIdList.push(file.id);
        }
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
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "Delete queued — running in background",
            });
            this.activeOperation = "";
          })
          .catch(handleError);
      };
      this.showConfirmDialog = true;
    },
    async clickedDeleteFolder() {
      const message = `Delete the current Folder? (Can't be undone!)\n`;
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = message;
      this.confirmDialogCallback = async () => {
        const parentFolderId = FoldersStore().getParentFolder(this.folder).id;
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
            FoldersStore().fetch();
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
      };
      this.showConfirmDialog = true;
    },
    onConfirmDialog() {
      this.showConfirmDialog = false;
      if (this.confirmDialogCallback) {
        this.confirmDialogCallback();
      }
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

@media (min-width: 701px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: auto 1fr 1fr;
    column-gap: 1em;
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

@media (max-width: 700px) {
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
    grid-row: 3;
    grid-column-start: 1;
    grid-column-end: span 2;
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
