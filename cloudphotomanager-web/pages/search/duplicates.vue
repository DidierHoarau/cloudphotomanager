<template>
  <div class="duplicate-gallery-layout page">
    <NavigationSearch
      class="duplicate-gallery-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
    <div class="duplicate-toolbar">
      <input
        v-model="analysisFilter"
        type="search"
        placeholder="Filter duplicates by filename or path…"
        class="duplicate-filter-input"
        @input="onSearchFilterChanged"
      />
      <kbd v-if="!loading && filteredFiles.length > 0"
        >Set Found: {{ filteredFiles.length }}</kbd
      >
    </div>
    <div class="analysis-item-list">
      <Loading v-if="loading" />
      <div v-else class="duplicate-card-grid">
        <div
          v-for="file in pagedFiles"
          :key="file.id"
          class="duplicate-card"
        >
          <div class="duplicate-card-thumb" @click="focusGalleryItem(file)">
            <img
              :src="getThumbnailUrl(file)"
              onerror="
                this.onerror = null;
                this.src = '/images/file-sync-in-progress.webp';
              "
              alt="thumbnail"
            />
            <span class="duplicate-card-badge"
              >x{{ file.duplicates.files.length }}</span
            >
          </div>
          <div class="duplicate-card-paths">
            <div
              v-for="dup in file.duplicates.files"
              :key="dup.id"
              class="duplicate-card-path"
            >
              {{ getFolderPath(dup.folderId) }}/{{ dup.filename }}
            </div>
          </div>
        </div>
      </div>
      <!-- Pagination controls -->
      <div v-if="!loading && totalPages > 1" class="dup-pagination">
        <button
          class="dup-page-btn"
          :disabled="currentPage === 0"
          @click="currentPage = 0"
          title="First page"
        >
          <i class="bi bi-chevron-double-left"></i>
        </button>
        <button
          class="dup-page-btn"
          :disabled="currentPage === 0"
          @click="currentPage--"
          title="Previous page"
        >
          <i class="bi bi-chevron-left"></i>
        </button>
        <span class="dup-page-info"
          >{{ currentPage + 1 }} / {{ totalPages }}</span
        >
        <button
          class="dup-page-btn"
          :disabled="currentPage >= totalPages - 1"
          @click="currentPage++"
          title="Next page"
        >
          <i class="bi bi-chevron-right"></i>
        </button>
        <button
          class="dup-page-btn"
          :disabled="currentPage >= totalPages - 1"
          @click="currentPage = totalPages - 1"
          title="Last page"
        >
          <i class="bi bi-chevron-double-right"></i>
        </button>
      </div>
    </div>

    <!-- Detail dialog -->
    <div
      v-if="selectedFile"
      class="dup-dialog-overlay"
      @click.self="clickedClose()"
    >
      <article class="dup-dialog">
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            @click.prevent="clickedClose()"
          ></a>
          Duplicate Group
        </header>
        <div class="dup-dialog-thumb">
          <img
            :src="getThumbnailUrl(selectedFile)"
            onerror="
              this.onerror = null;
              this.src = '/images/file-sync-in-progress.webp';
            "
            alt="Thumbnail"
          />
        </div>
        <table class="dup-info-table">
          <tbody>
            <tr>
              <td class="dup-info-label">Count</td>
              <td>{{ selectedFile.duplicates.files.length }} copies</td>
            </tr>
          </tbody>
        </table>
        <hr />
        <strong>Files in this group</strong>
        <div class="dup-files-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Folder</th>
                <th scope="col">File</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dup in selectedFile.duplicates.files" :key="dup.id">
                <td>{{ getFolderPath(dup.folderId) }}</td>
                <td>{{ dup.filename }}</td>
                <td class="dup-files-action-cell">
                  <button
                    class="dup-delete-btn"
                    @click="deleteDuplicate(dup)"
                    title="Delete this file"
                  >
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

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
import { findIndex, debounce } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      analysis: [],
      menuOpened: true,
      serverUrl: "",
      staticUrl: "",
      selectedFile: null,
      loading: false,
      requestEtag: "",
      analysisFilter: "",
      activeFilter: "",
      currentPage: 0,
      pageSize: 60,
      selectedFiles: [],
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
    };
  },
  async created() {
    const config = await Config.get();
    this.serverUrl = config.SERVER_URL;
    this.staticUrl = config.STATIC_URL;
    await AccountsStore().fetch();
    await FoldersStore().fetch();
  },
  computed: {
    totalPages() {
      return Math.max(1, Math.ceil(this.filteredFiles.length / this.pageSize));
    },
    pagedFiles() {
      const start = this.currentPage * this.pageSize;
      return this.filteredFiles.slice(start, start + this.pageSize);
    },
    folderMap() {
      const map = new Map();
      for (const folder of FoldersStore().folders) {
        map.set(folder.id, folder.folderpath);
      }
      return map;
    },
    filteredFiles() {
      if (!this.activeFilter) {
        return this._buildFileList(this.analysis);
      }
      const q = this.activeFilter.toLowerCase();
      const matched = this.analysis.filter((duplicate) => {
        return duplicate.files.some(
          (f) =>
            f.filename.toLowerCase().includes(q) ||
            (this.folderMap.get(f.folderId) || "").toLowerCase().includes(q),
        );
      });
      return this._buildFileList(matched);
    },
  },
  watch: {
    activeFilter() {
      this.currentPage = 0;
    },
  },
  methods: {
    async loadAccountDuplicate(accountId) {
      const requestEtag = new Date().toISOString();
      this.requestEtag = requestEtag;
      this.loading = true;
      this.analysis = [];
      this.currentPage = 0;
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
      // analysis is now the source of truth; filteredFiles is computed
    },
    _buildFileList(analysisList) {
      const result = [];
      for (const duplicate of analysisList) {
        if (duplicate.files.length < 2) continue;
        const src = duplicate.files[0];
        result.push({
          ...src,
          info: src.info ? { ...src.info } : src.info,
          filename: `(x${duplicate.files.length} duplicates) ${src.filename}`,
          duplicates: duplicate,
        });
      }
      return result;
    },
    getThumbnailUrl(file) {
      if (!file || !this.staticUrl) return "";
      return (
        this.staticUrl +
        "/" +
        file.accountId +
        "/" +
        file.id[0] +
        "/" +
        file.id[1] +
        "/" +
        file.id +
        "/thumbnail.webp"
      );
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
            // filteredFiles is computed from this.analysis — reactivity handles re-render
            if (duplicate.files.length < 2) {
              // No longer a duplicate group — close dialog if open for this group
              if (
                this.selectedFile &&
                this.selectedFile.duplicates === duplicate
              ) {
                this.selectedFile = null;
              }
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
    onSearchFilterChanged: debounce(function () {
      this.activeFilter = this.analysisFilter;
    }, 2000),
  },
};
</script>

<style scoped>
/* ── Page layout ─────────────────────────────────────────── */
.duplicate-gallery-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  grid-template-columns: 1fr;
  gap: 1em;
}

/* ── Toolbar: count badge + filter input ─────────────────── */
.duplicate-toolbar {
  display: grid;
  grid-template-columns: 3fr 1fr;
  align-items: center;
  gap: 0.75em;
}

/* ── Duplicate card grid ─────────────────────────────────── */
.duplicate-card-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11em, 1fr));
  gap: 1em;
  align-items: start;
}
.duplicate-card {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  cursor: default;
}
.duplicate-card-thumb {
  position: relative;
  cursor: pointer;
}
.duplicate-card-thumb img {
  width: 100%;
  height: 8em;
  object-fit: cover;
  border-radius: 0.3em;
  display: block;
}
.duplicate-card-badge {
  position: absolute;
  top: 0.3em;
  right: 0.3em;
  background: rgba(20, 20, 40, 0.75);
  color: #aaf;
  font-size: 0.7em;
  padding: 0.15em 0.45em;
  border-radius: 0.9em;
  pointer-events: none;
}
.duplicate-card-paths {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
}
.duplicate-card-path {
  font-size: 0.62em;
  opacity: 0.65;
  word-break: break-all;
  line-height: 1.3;
}

/* ── Detail dialog (matches DialogFileInfo style) ────────── */
.dup-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}
.dup-dialog {
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  width: 30em;
}
.dup-dialog-thumb {
  text-align: center;
  margin-bottom: 0.75em;
}
.dup-dialog-thumb img {
  max-width: 100%;
  max-height: 12em;
  object-fit: contain;
  border-radius: 0.35em;
}
.dup-info-table {
  width: 100%;
  border-collapse: collapse;
}
.dup-info-table td {
  padding: 0.3em 0;
  vertical-align: top;
  word-break: break-all;
}
.dup-info-label {
  font-weight: 600;
  white-space: nowrap;
  padding-right: 1em;
  width: 5em;
}
.dup-files-table {
  max-width: 100%;
  overflow-x: hidden;
  margin-top: 0.5em;
}
.dup-files-table table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.dup-files-table td,
.dup-files-table th {
  word-break: break-all;
  overflow-wrap: anywhere;
  padding: 0.3em 0.4em;
  vertical-align: middle;
}
.dup-files-action-cell {
  width: 2.5em;
  text-align: center;
  word-break: normal;
}
.dup-delete-btn {
  background: transparent;
  border: none;
  color: #dc3545;
  cursor: pointer;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  border-radius: 0.25em;
  transition: background 0.15s;
}
.dup-delete-btn:hover:not(:disabled) {
  background: rgba(220, 53, 69, 0.15);
}
.dup-delete-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ── Pagination ──────────────────────────────────────────── */
.dup-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  padding-top: 1em;
}
.dup-page-btn {
  background: transparent;
  border: 1px solid var(--pico-muted-border-color, #555);
  color: inherit;
  cursor: pointer;
  padding: 0.3em 0.6em;
  border-radius: 0.3em;
  font-size: 0.9em;
  line-height: 1;
  transition: background 0.15s;
}
.dup-page-btn:hover:not(:disabled) {
  background: var(--pico-primary-background, rgba(255, 255, 255, 0.08));
}
.dup-page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.dup-page-info {
  min-width: 5em;
  text-align: center;
  font-size: 0.9em;
}
</style>
