<template>
  <div class="gallery-layout page">
    <div class="gallery-layout-actions actions">
      <div v-for="account in accountsStore.accounts" v-bind:key="account.id">
        <button v-on:click="loadAccountDuplicate(account.id)">{{ account.name }}</button>
      </div>
      <input v-if="analysis.length > 0" v-model="analysisFilter" type="text" v-on:input="analysisFilterChanged" />
      <kbd v-if="analysis.length > 0">Duplicates Found: {{ analysisFiltered.length }}</kbd>
    </div>
    <div class="analysis-items-actions actions"></div>
    <div class="analysis-item-list">
      <Loading v-if="loading" />
      <article class="card analysis-item" v-for="item in analysisFiltered" v-bind:key="item.hash">
        <div class="analysis-item-image">
          <img
            :src="serverUrl + '/accounts/' + item.files[0].accountId + '/files/' + item.files[0].id + '/thumbnail'"
            onerror="this.onerror=null; this.src='/images/file-sync-in-progress.webp'"
          />
        </div>
        <div class="analysis-file-list">
          <div class="analysis-file-list-file" v-for="file in item.files" v-bind:key="file.id">
            <div class="analysis-file-list-file-name">
              {{ displayFolderPath(item.folders, file.folderId) }}/{{ file.filename }}
            </div>
            <div class="analysis-file-list-file-actions">
              <i class="bi bi-arrows-move"></i>
              <i v-on:click="deleteDuplicate(file, item.folders)" class="bi bi-trash-fill"></i>
            </div>
          </div>
        </div>
      </article>
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
const accountsStore = AccountsStore();
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
          `${(await Config.get()).SERVER_URL}/accounts/${accountId}/analysis/duplicates`,
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          if (this.requestEtag === requestEtag) {
            this.analysis = res.data.duplicates;
            this.analysisFilterChanged();
          }
        })
        .finally(() => {
          this.requestEtag = "";
          this.loading = false;
        })
        .catch(handleError);
    },
    async deleteDuplicate(file, folders) {
      if (
        confirm(
          `Delete the file? (Can't be undone!)\nFile: ${file.filename} \nFolder: ${this.displayFolderPath(
            folders,
            file.folderId
          )}`
        ) == true
      ) {
        await axios
          .delete(
            `${(await Config.get()).SERVER_URL}/accounts/${file.accountId}/files/${file.id}/operations/delete`,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              text: "File deleted",
            });
            const hashIndex = _.findIndex(this.analysis, { hash: file.hash });
            this.analysis[hashIndex].files.splice(_.findIndex(this.analysis[hashIndex].files), 1);
            if (this.analysis[hashIndex].files.length === 0) {
              this.analysis.splice(hashIndex, 1);
            }
          })
          .catch(handleError);
      }
    },
    displayFolderPath(folders, folderId) {
      return _.find(folders, { id: folderId }).folderpath;
    },
    analysisFilterChanged: _.debounce(async function (e) {
      if (!this.analysisFilter) {
        this.analysisFiltered = this.analysis;
        return;
      }
      this.analysisFiltered = [];
      for (const analysis of this.analysis) {
        let added = false;
        for (const file of analysis.files) {
          if (!added && file.filename.toLowerCase().indexOf(this.analysisFilter.toLowerCase()) >= 0) {
            added = true;
          }
        }
        for (const folder of analysis.folders) {
          if (!added && folder.folderpath.toLowerCase().indexOf(this.analysisFilter.toLowerCase()) >= 0) {
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
    grid-template-rows: auto 2.5em 1fr;
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
    grid-template-rows: auto 2.5em 1fr;
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
  grid-template-columns: repeat(auto-fill, minmax(20em, 1fr));
  gap: 1em;
}
</style>
