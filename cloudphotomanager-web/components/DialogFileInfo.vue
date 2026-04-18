<template>
  <div>
    <div v-if="showConfirmDelete" class="confirm-overlay">
      <DialogConfirm
        title="Confirm Delete"
        :message="confirmDeleteMessage"
        @onConfirm="executeDeleteDuplicate"
        @onCancel="showConfirmDelete = false"
      />
    </div>
    <dialog open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            @click.prevent="clickedClose()"
          ></a>
          File Info
        </header>
        <table class="file-info-table">
          <tbody>
            <tr>
              <td class="file-info-label">Name</td>
              <td>{{ file.filename }}</td>
            </tr>
            <tr>
              <td class="file-info-label">Location</td>
              <td>
                <NuxtLink
                  :to="folderLink(file.accountId, file.folderId)"
                  @click="clickedClose()"
                >
                  {{ folderPath }}
                </NuxtLink>
              </td>
            </tr>
            <tr>
              <td class="file-info-label">Date</td>
              <td>{{ formatDate(file.dateMedia || file.dateSync) }}</td>
            </tr>
            <tr>
              <td class="file-info-label">Size</td>
              <td>{{ formatSize(file.info && file.info.size) }}</td>
            </tr>
          </tbody>
        </table>
        <hr />
        <strong>Duplicates</strong>
        <Loading v-if="loadingDuplicates" />
        <p v-else-if="!duplicates"><small>No duplicates found.</small></p>
        <div v-else class="duplicate-files-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Folder</th>
                <th scope="col">File</th>
                <th v-if="isAdmin" scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dup in duplicates.files" :key="dup.id">
                <td>
                  <NuxtLink
                    :to="folderLink(dup.accountId, dup.folderId)"
                    @click="clickedClose()"
                  >
                    {{ getDuplicateFolderPath(dup.folderId) }}
                  </NuxtLink>
                </td>
                <td>{{ dup.filename }}</td>
                <td v-if="isAdmin">
                  <button
                    class="dup-delete-btn"
                    @click="clickedDeleteDuplicate(dup)"
                    :disabled="isDupProcessing(dup.id)"
                    title="Delete this duplicate"
                  >
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const foldersStore = FoldersStore();
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  props: {
    file: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      duplicates: null,
      loadingDuplicates: false,
      showConfirmDelete: false,
      confirmDeleteMessage: "",
      pendingDeleteDup: null,
    };
  },
  async created() {
    await this.loadDuplicates();
  },
  methods: {
    clickedClose() {
      this.$emit("onClose");
    },
    formatDate(date) {
      if (!date) return "Unknown";
      return new Date(date).toLocaleString();
    },
    formatSize(bytes) {
      if (!bytes && bytes !== 0) return "Unknown";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    },
    folderLink(accountId, folderId) {
      return { path: "/gallery", query: { accountId, folderId } };
    },
    async loadDuplicates() {
      this.loadingDuplicates = true;
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/${this.file.accountId}/analysis/duplicates/${this.file.id}`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.duplicates = res.data.duplicate;
        })
        .catch(handleError)
        .finally(() => {
          this.loadingDuplicates = false;
        });
    },
    getDuplicateFolderPath(folderId) {
      const folder = FoldersStore().folders.find((f) => f.id === folderId);
      return folder ? folder.folderpath : folderId;
    },
    clickedDeleteDuplicate(dup) {
      this.confirmDeleteMessage = `Delete this duplicate? (Can't be undone!)\nFile: ${dup.filename}`;
      this.pendingDeleteDup = dup;
      this.showConfirmDelete = true;
    },
    async executeDeleteDuplicate() {
      this.showConfirmDelete = false;
      const dup = this.pendingDeleteDup;
      if (!dup) return;
      this.pendingDeleteDup = null;
      SyncStore().markFilesAsPending([dup.id]);
      SyncStore().markOperationInProgress();
      try {
        await axios.post(
          `${(await Config.get()).SERVER_URL}/accounts/${dup.accountId}/files/batch/operations/fileDelete`,
          { fileIdList: [dup.id] },
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Delete queued \u2014 running in background",
        });
        // Remove from local list
        if (this.duplicates && this.duplicates.files) {
          this.duplicates.files = this.duplicates.files.filter(
            (f) => f.id !== dup.id,
          );
        }
        this.$emit("onDuplicateDeleted", dup.id);
      } catch (err) {
        handleError(err);
      }
    },
    isDupProcessing(fileId) {
      return SyncStore().isFileProcessing(fileId);
    },
  },
  computed: {
    folderPath() {
      const folder = FoldersStore().folders.find(
        (f) => f.id === this.file.folderId,
      );
      return folder ? folder.folderpath : this.file.folderId;
    },
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
  },
};
</script>

<style scoped>
.file-info-table {
  width: 100%;
  border-collapse: collapse;
}
.file-info-table td {
  padding: 0.3em 0;
  vertical-align: top;
  word-break: break-all;
}
.file-info-label {
  font-weight: 600;
  white-space: nowrap;
  padding-right: 1em;
  width: 5em;
}
.duplicate-files-table {
  max-width: 100%;
  overflow-x: hidden;
  margin-top: 0.5em;
}
.duplicate-files-table table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.duplicate-files-table td,
.duplicate-files-table th {
  word-break: break-all;
  overflow-wrap: anywhere;
  padding: 0.3em 0.4em;
  vertical-align: middle;
}
.duplicate-files-table th:last-child,
.duplicate-files-table td:last-child {
  width: 2.5em;
  text-align: center;
  word-break: normal;
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
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
</style>
