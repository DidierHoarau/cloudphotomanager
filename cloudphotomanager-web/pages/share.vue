<template>
  <div class="share-layout page">
    <div v-if="invalidToken" class="share-state">
      <i class="bi bi-link-slash"></i>
      <p>This link is invalid, expired or has been revoked.</p>
    </div>
    <Loading v-else-if="loading" />
    <template v-else>
      <div class="share-header">
        <h1 class="share-title">
          <i :class="shareIcon"></i>
          {{ shareTitle }}
        </h1>
        <p class="share-stats">
          <span class="share-stat">{{ photoCountText }}</span>
          <span v-if="shareMeta && shareMeta.totalSize" class="share-stat">{{
            displaySize(shareMeta.totalSize)
          }}</span>
        </p>
        <p
          v-if="shareMeta && shareMeta.dateExpires"
          class="share-expiry-notice"
          role="note"
        >
          <i class="bi bi-clock" aria-hidden="true"></i>
          This link expires on {{ formatDate(shareMeta.dateExpires) }}.
        </p>
        <nav
          v-if="isFolder"
          class="share-breadcrumb"
          aria-label="Shared folders"
        >
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
            <span v-if="index > 0" class="share-breadcrumb-sep">/</span>
            <a
              v-if="index < breadcrumbs.length - 1"
              href="#"
              @click.prevent="openFolder(crumb)"
              >{{ crumb.name }}</a
            >
            <strong v-else>{{ crumb.name }}</strong>
          </template>
        </nav>
        <div v-if="isFolder && childFolders.length > 0" class="share-folders">
          <button
            v-for="sub in childFolders"
            :key="sub.id"
            class="secondary outline share-folder-btn"
            @click="openFolder(sub)"
          >
            <i class="bi bi-folder2"></i> {{ sub.name }}
          </button>
        </div>
        <div v-if="files.length > 0" class="share-actions">
          <kbd v-if="selectedFiles.length > 0">
            Selected: {{ selectedFiles.length }}
          </kbd>
          <button
            v-if="selectedFiles.length > 0"
            class="secondary outline"
            @click="clearSelection()"
          >
            Clear selection
          </button>
          <button
            v-if="selectedFiles.length > 0"
            class="secondary outline"
            :disabled="downloading"
            @click="downloadSelected()"
          >
            <i class="bi bi-download"></i>
            {{ downloading ? "Zipping..." : "Download selected" }}
          </button>
          <button
            class="secondary outline"
            :disabled="downloading"
            @click="downloadAll()"
          >
            <i class="bi bi-file-earmark-zip"></i>
            {{ downloading ? "Zipping..." : "Download all (.zip)" }}
          </button>
        </div>
      </div>
      <div class="share-file-list">
        <div v-if="files.length === 0" class="share-state">
          <i :class="isFolder ? 'bi bi-folder2-open' : 'bi bi-images'"></i>
          <p>
            {{
              isFolder
                ? "No photos in this folder."
                : "This share has no photos."
            }}
          </p>
        </div>
        <template v-else>
          <Gallery
            :files="files"
            :enableSelection="true"
            :selectedFiles="selectedFiles"
            @focusGalleryItem="focusGalleryItem"
            @onFileSelected="onFileSelected"
          />
          <button
            v-if="hasMore"
            class="secondary outline share-more-btn"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? "Loading..." : "Load more" }}
          </button>
        </template>
      </div>
      <GalleryItemFocus
        v-if="displayFullScreen"
        :galleryFiles="files"
        :initialPosition="positionFocus"
        :selectedFiles="selectedFiles"
        :shareToken="token"
        class="share-item-focus"
        @onFileClosed="displayFullScreen = false"
        @onFileSelected="onFileSelected"
      />
    </template>
  </div>
</template>

<script>
import { ShareService } from "~~/services/ShareService";
import { BulkDownloadService } from "~~/services/BulkDownloadService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { findIndex } from "lodash";

export default {
  data() {
    return {
      token: "",
      invalidToken: false,
      shareMeta: null,
      folders: [],
      currentFolder: null,
      files: [],
      selectedFiles: [],
      currentPage: 0,
      pageSize: 60,
      hasMore: false,
      loading: false,
      loadingMore: false,
      downloading: false,
      displayFullScreen: false,
      positionFocus: 0,
    };
  },
  computed: {
    scope() {
      return this.shareMeta ? this.shareMeta.scope : "folder";
    },
    isFolder() {
      return this.scope === "folder";
    },
    shareTitle() {
      if (!this.shareMeta) {
        return "Shared";
      }
      if (this.scope === "album") {
        return this.shareMeta.albumName || this.shareMeta.name || "Album";
      }
      if (this.scope === "file") {
        return this.shareMeta.fileName || this.shareMeta.name || "File";
      }
      return this.shareMeta.folderName || "Shared folder";
    },
    shareIcon() {
      if (this.scope === "album") return "bi bi-collection";
      if (this.scope === "file") return "bi bi-file-earmark-image";
      return "bi bi-images";
    },
    photoCountText() {
      const count = this.shareMeta ? this.shareMeta.photoCount || 0 : 0;
      return count === 1 ? "1 photo" : `${count} photos`;
    },
    // The shared subtree root: the listed folder with the shortest path.
    shareRoot() {
      let root = null;
      for (const folder of this.folders) {
        if (!root || folder.folderpath.length < root.folderpath.length) {
          root = folder;
        }
      }
      return root;
    },
    childFolders() {
      if (!this.currentFolder) return [];
      const prefix = this.currentFolder.folderpath;
      return this.folders
        .filter((folder) => {
          if (folder.folderpath === prefix) return false;
          if (prefix !== "/" && !folder.folderpath.startsWith(`${prefix}/`)) {
            return false;
          }
          const rest =
            prefix === "/"
              ? folder.folderpath.replace(/^\//, "")
              : folder.folderpath.slice(prefix.length + 1);
          return !rest.includes("/");
        })
        .map((folder) => ({
          id: folder.id,
          path: folder.folderpath,
          name: folder.folderpath.split("/").filter(Boolean).pop() || "/",
        }));
    },
    breadcrumbs() {
      if (!this.currentFolder || !this.shareRoot) return [];
      const crumbs = [
        {
          id: this.shareRoot.id,
          path: this.shareRoot.folderpath,
          name: this.shareTitle,
        },
      ];
      const rootPath =
        this.shareRoot.folderpath === "/" ? "" : this.shareRoot.folderpath;
      const suffix = this.currentFolder.folderpath
        .slice(rootPath.length)
        .replace(/^\//, "");
      let path = rootPath;
      for (const part of suffix.split("/").filter(Boolean)) {
        path = `${path}/${part}`;
        const folder = this.folders.find((f) => f.folderpath === path);
        crumbs.push({ id: folder ? folder.id : "", path, name: part });
      }
      return crumbs;
    },
  },
  async created() {
    this.token = String(this.$route.query.t || "");
    if (!this.token) {
      this.invalidToken = true;
      return;
    }
    this.loading = true;
    try {
      this.shareMeta = await ShareService.getMeta(this.token);
      if (this.isFolder) {
        this.folders = await ShareService.getFolders(this.token);
        this.currentFolder = this.shareRoot;
        if (!this.currentFolder) {
          this.invalidToken = true;
          return;
        }
      }
      await this.fetchFiles(true);
    } catch {
      this.invalidToken = true;
    } finally {
      this.loading = false;
    }
  },
  methods: {
    async fetchFiles(reset = false) {
      if (reset) {
        this.currentPage = 0;
        this.files = [];
        this.selectedFiles = [];
      }
      let result;
      if (this.isFolder) {
        if (!this.currentFolder) return;
        result = await ShareService.getFiles(
          this.token,
          this.currentFolder.id,
          {
            page: this.currentPage,
            pageSize: this.pageSize,
            sortOrder: "desc",
            includeSubFolders: false,
          },
        );
      } else {
        result = await ShareService.getItems(this.token, {
          page: this.currentPage,
          pageSize: this.pageSize,
          sortOrder: "desc",
        });
      }
      const newFiles = result.files || [];
      this.files = reset ? newFiles : [...this.files, ...newFiles];
      this.hasMore =
        (result.total || 0) > (this.currentPage + 1) * this.pageSize;
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore) return;
      this.loadingMore = true;
      try {
        this.currentPage += 1;
        await this.fetchFiles();
      } catch (err) {
        this.currentPage -= 1;
        handleError(err);
      } finally {
        this.loadingMore = false;
      }
    },
    async openFolder(folder) {
      if (!folder || !folder.id || folder.id === this.currentFolder?.id) {
        return;
      }
      this.currentFolder = { id: folder.id, folderpath: folder.path };
      this.displayFullScreen = false;
      this.loading = true;
      try {
        await this.fetchFiles(true);
      } catch {
        this.invalidToken = true;
      } finally {
        this.loading = false;
      }
    },
    onFileSelected(file) {
      const selectedIndex = findIndex(this.selectedFiles, { id: file.id });
      if (selectedIndex < 0) {
        this.selectedFiles.push(file);
      } else {
        this.selectedFiles.splice(selectedIndex, 1);
      }
    },
    clearSelection() {
      this.selectedFiles = [];
    },
    async downloadSelected() {
      if (this.downloading || this.selectedFiles.length === 0) return;
      this.downloading = true;
      try {
        await BulkDownloadService.downloadShareZip(
          this.token,
          this.selectedFiles,
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Download started" });
      } catch (err) {
        handleError(err);
      } finally {
        this.downloading = false;
      }
    },
    async downloadAll() {
      if (this.downloading) return;
      this.downloading = true;
      try {
        await BulkDownloadService.downloadShareZip(this.token, this.files, {
          all: true,
        });
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Download started" });
      } catch (err) {
        handleError(err);
      } finally {
        this.downloading = false;
      }
    },
    focusGalleryItem(file) {
      this.displayFullScreen = true;
      this.positionFocus = this.files.findIndex((f) => f.id === file.id);
    },
    displaySize(size) {
      if (!size) return "";
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
    },
    formatDate(date) {
      if (!date) return "";
      return new Date(date).toLocaleString();
    },
  },
};
</script>

<style scoped>
.share-layout {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-base);
  height: calc(var(--app-height, 100vh) - 4em);
  overflow: hidden;
  padding: var(--space-sm);
}
.share-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.share-title {
  margin: 0;
  font-size: var(--font-xl);
  word-break: break-word;
}
.share-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0;
  font-size: var(--font-sm);
  opacity: 0.8;
}
.share-stat {
  padding: 0.1em 0.5em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}
.share-expiry-notice {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--color-warning);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.share-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-base);
}
.share-breadcrumb-sep {
  opacity: 0.4;
}
.share-folders {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.share-folder-btn {
  width: auto;
  margin: 0;
  padding: var(--space-xs) var(--space-md);
}
.share-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.share-actions button {
  width: auto;
  margin: 0;
}
.share-file-list {
  overflow: auto;
}
.share-more-btn {
  margin: var(--space-base) auto;
  display: block;
  width: auto;
}
.share-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  color: var(--color-accent);
  opacity: 0.75;
  font-size: var(--font-lg);
  text-align: center;
  padding: var(--space-3xl) var(--space-base);
}
.share-state i {
  font-size: 3em;
}
.share-state p {
  margin: 0;
}
.share-item-focus {
  background-color: black;
  position: fixed;
  top: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  z-index: 100;
}
@media (max-width: 900px) {
  .share-layout {
    height: auto;
    overflow: visible;
  }
  .share-file-list {
    overflow: visible;
  }
}
</style>
