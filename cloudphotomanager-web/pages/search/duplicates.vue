<template>
  <div class="duplicate-gallery-layout page">
    <NavigationSearch
      class="duplicate-gallery-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
    <div>
      <kbd v-if="files.length > 0">Set Found: {{ files.length }}</kbd>
    </div>
    <div class="analysis-item-list">
      <Loading v-if="loading" />
      <Gallery
        v-else
        :files="files"
        :enableSelection="false"
        @focusGalleryItem="focusGalleryItem"
        @onFileSelected="onFileSelected"
        :selectedFiles="selectedFiles"
      />
    </div>
    <dialog v-if="selectedFile" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="clickedClose()"
          ></a>
          Duplicate
        </header>
        <MediaDisplay :file="selectedFile" />
        <div class="duplicate-files-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Folder</th>
                <th scope="col">File</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in selectedFile.duplicates.files" :key="file.id">
                <th scope="row">{{ getFolderPath(file.folderId) }}</th>
                <td>{{ file.filename }}</td>
                <td class="duplicate-files-actions">
                  <button
                    class="secondary outline"
                    v-on:click="deleteDuplicate(file)"
                  >
                    <i class="bi bi-trash-fill"></i> Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </dialog>
    <DialogConfirm
      v-if="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @onConfirm="onConfirmDialog"
      @onCancel="showConfirmDialog = false"
    />
  </div>
</template>

<script>
import axios from "axios";
import { debounce, findIndex } from "lodash";
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
      analysisFilter: "",
      selectedFiles: [],
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
    await FoldersStore().fetch();
  },
  computed: {
    folderMap() {
      const map = new Map();
      for (const folder of FoldersStore().folders) {
        map.set(folder.id, folder.folderpath);
      }
      return map;
    },
  },
  methods: {
    async loadAccountDuplicate(accountId) {
      const requestEtag = new Date().toISOString();
      this.requestEtag = requestEtag;
      this.loading = true;
      this.analysis = [];
      await axios
        .get(
          `${
            (await Config.get()).SERVER_URL
          }/accounts/${accountId}/analysis/duplicates`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          if (this.requestEtag === requestEtag) {
            this.analysis = res.data.duplicates;
            return this.loadAccountDuplicateProcess();
          }
        })
        .finally(() => {
          this.requestEtag = "";
          this.loading = false;
        })
        .catch(handleError);
    },
    loadAccountDuplicateProcess() {
      const newFiles = [];
      for (const duplicate of this.analysis) {
        if (duplicate.files.length < 2) {
          continue;
        }
        const src = duplicate.files[0];
        const fileReference = {
          ...src,
          info: src.info ? { ...src.info } : src.info,
          filename: `(x${duplicate.files.length} duplicates) ${src.filename}`,
          duplicates: duplicate,
        };
        newFiles.push(fileReference);
      }
      this.files = newFiles;
    },
    async onAccountSelected(account) {
      await this.loadAccountDuplicate(account.id);
    },
    getFolderPath(id) {
      return this.folderMap.get(id) ?? "";
    },
    async onFileSelected(file) {
      // TODO
    },
    async focusGalleryItem(file) {
      this.selectedFile = file;
    },
    async deleteDuplicate(file) {
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = `Delete the file? (Can't be undone!)\nFile: ${file.filename} \nFolder: ${this.getFolderPath(file.folderId)}`;
      this.confirmDialogCallback = async () => {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${
              file.accountId
            }/files/batch/operations/fileDelete`,
            { fileIdList: [file.id] },
            await AuthService.getAuthHeader(),
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "File deleted",
            });
            const hashIndex = findIndex(this.analysis, { hash: file.hash });
            if (hashIndex < 0) return;
            const duplicate = this.analysis[hashIndex];
            const fileIndex = findIndex(duplicate.files, { id: file.id });
            if (fileIndex >= 0) {
              duplicate.files.splice(fileIndex, 1);
            }
            // Update files[] surgically: no full rebuild needed
            const filesIndex = findIndex(
              this.files,
              (f) => f.duplicates === duplicate,
            );
            if (duplicate.files.length < 2) {
              // No longer a duplicate group — remove from list
              if (filesIndex >= 0) {
                this.files.splice(filesIndex, 1);
              }
              // Also close dialog if it was showing this group
              if (
                this.selectedFile &&
                this.selectedFile.duplicates === duplicate
              ) {
                this.selectedFile = null;
              }
            } else if (filesIndex >= 0) {
              // Update count label in-place
              const entry = this.files[filesIndex];
              const baseName = entry.filename.replace(
                /^\(x\d+ duplicates\) /,
                "",
              );
              entry.filename = `(x${duplicate.files.length} duplicates) ${baseName}`;
            }
            EventBus.emit(EventTypes.FOLDER_UPDATED, {});
            EventBus.emit(EventTypes.FILE_UPDATED, {});
          })
          .catch(handleError);
      };
      this.showConfirmDialog = true;
    },
    onConfirmDialog() {
      this.showConfirmDialog = false;
      if (this.confirmDialogCallback) {
        this.confirmDialogCallback();
      }
    },
    clickedClose() {
      this.selectedFile = null;
    },
    onSearchFilterChanged: debounce(async function (e) {
      if (!this.analysisFilter) {
        this.analysisFiltered = this.analysis;
        return;
      }
      this.analysisFiltered = [];
      for (const analysis of this.analysis) {
        let added = false;
        for (const file of analysis.files) {
          if (
            !added &&
            file.filename
              .toLowerCase()
              .indexOf(this.analysisFilter.toLowerCase()) >= 0
          ) {
            added = true;
          }
        }
        for (const folder of analysis.folders) {
          if (
            !added &&
            folder.folderpath
              .toLowerCase()
              .indexOf(this.analysisFilter.toLowerCase()) >= 0
          ) {
            added = true;
          }
        }
        if (added) {
          this.analysisFiltered.push(analysis);
        }
      }
    }, 500),
  },
};
</script>

<style scoped>
.duplicate-gallery-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  grid-template-columns: 1fr;
  gap: 1em;
}
.analysis-item {
  margin-top: 1em;
}
.duplicate-files-actions {
  padding-bottom: 0.3em;
}
.duplicate-files-actions button,
.duplicate-files-actions kbd {
  padding: 0.3em 0.7em;
  font-size: 0.8em;
}

.duplicate-files-actions kbd {
  height: 2.2em;
}

.duplicate-files-table {
  max-width: 100%;
  overflow-x: auto;
}
</style>
