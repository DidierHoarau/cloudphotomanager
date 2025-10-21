<template>
  <div class="duplicate-gallery-layout page">
    <NavigationSearch
      class="duplicate-gallery-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
    <div class="duplicate-gallery-criteria">
      <input
        v-model="searchKeyword"
        type="search"
        name="search"
        placeholder="Search File"
        aria-label="Search"
        class="folder-component-layout-filter"
        v-on:input="onSearchFilterChanged"
      />
    </div>

    <div class="analysis-items-actions actions"></div>
    <div class="analysis-item-list">
      <Loading v-if="loading" />
      <Gallery
        v-else
        :files="files"
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
        <div v-for="file in selectedFile.duplicates" :key="file.id">
          {{ file }}
        </div>
        <button>Add</button>
      </article>
    </dialog>
  </div>
</template>

<script>
import axios from "axios";
import { debounce, find, findIndex } from "lodash";
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
      selectedFiles: [],
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
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
            (
              await Config.get()
            ).SERVER_URL
          }/accounts/${accountId}/analysis/duplicates`,
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          const newFiles = [];
          if (this.requestEtag === requestEtag) {
            this.analysis = res.data.duplicates;
            for (const duplicate of this.analysis) {
              const fileReference = JSON.parse(
                JSON.stringify(duplicate.files[0])
              );
              fileReference.duplicates = duplicate;
              fileReference.filename = `(x${duplicate.files.length} duplicates) ${fileReference.filename}`;
              newFiles.push(fileReference);
            }
            this.files = newFiles;
          }
        })
        .finally(() => {
          this.requestEtag = "";
          this.loading = false;
        })
        .catch(handleError);
    },
    async onAccountSelected(account) {
      this.currentAccountId = account.id;
      await this.loadAccountDuplicate(account.id);
    },
    async onFileSelected(file) {
      // TODO
    },
    async focusGalleryItem(file) {
      console.log("focusGalleryItem", file);
      this.selectedFile = file;
      // TODO
    },
    async deleteDuplicate(file, folders) {
      if (
        confirm(
          `Delete the file? (Can't be undone!)\nFile: ${
            file.filename
          } \nFolder: ${this.displayFolderPath(folders, file.folderId)}`
        ) == true
      ) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${
              file.accountId
            }/files/batch/operations/fileDelete`,
            { fileIdList: [file.id] },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "File deleted",
            });
            const hashIndex = findIndex(this.analysis, { hash: file.hash });
            this.analysis[hashIndex].files.splice(
              findIndex(this.analysis[hashIndex].files),
              1
            );
            if (this.analysis[hashIndex].files.length === 0) {
              this.analysis.splice(hashIndex, 1);
            }
            EventBus.emit(EventTypes.FOLDER_UPDATED, {});
            EventBus.emit(EventTypes.FILE_UPDATED, {});
          })
          .catch(handleError);
      }
    },
    displayFolderPath(folders, folderId) {
      return find(folders, { id: folderId }).folderpath;
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
  grid-template-rows: auto 2.5em 1fr;
  grid-template-columns: 1fr;
  gap: 1em;
}

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
</style>
