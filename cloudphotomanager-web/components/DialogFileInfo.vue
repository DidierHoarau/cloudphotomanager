<template>
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
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </dialog>
</template>

<script setup>
const foldersStore = FoldersStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";

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
  },
  computed: {
    folderPath() {
      const folder = FoldersStore().folders.find(
        (f) => f.id === this.file.folderId,
      );
      return folder ? folder.folderpath : this.file.folderId;
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
  overflow-x: auto;
  margin-top: 0.5em;
}
</style>
