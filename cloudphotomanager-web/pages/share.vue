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
          <i class="bi bi-images"></i>
          {{ folderName }}
          <small v-if="shareMeta && shareMeta.dateExpires" class="share-expiry">
            &middot; link expires {{ formatDate(shareMeta.dateExpires) }}
          </small>
        </h1>
        <nav class="share-breadcrumb" aria-label="Shared folders">
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
        <div class="share-folders" v-if="childFolders.length > 0">
          <button
            v-for="sub in childFolders"
            :key="sub.id"
            class="secondary outline share-folder-btn"
            @click="openFolder(sub)"
          >
            <i class="bi bi-folder2"></i> {{ sub.name }}
          </button>
        </div>
      </div>
      <div class="share-file-list">
        <div v-if="files.length === 0" class="share-state">
          <i class="bi bi-folder2-open"></i>
          <p>No photos in this folder.</p>
        </div>
        <template v-else>
          <Gallery
            :files="files"
            :enableSelection="false"
            @focusGalleryItem="focusGalleryItem"
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
        :shareToken="token"
        class="share-item-focus"
        @onFileClosed="displayFullScreen = false"
      />
    </template>
  </div>
</template>

<script>
import { ShareService } from "~~/services/ShareService";

export default {
  data() {
    return {
      token: "",
      invalidToken: false,
      shareMeta: null,
      folders: [],
      currentFolder: null,
      files: [],
      currentPage: 0,
      pageSize: 60,
      hasMore: false,
      loading: false,
      loadingMore: false,
      displayFullScreen: false,
      positionFocus: 0,
    };
  },
  computed: {
    folderName() {
      return this.shareMeta ? this.shareMeta.folderName : "Shared folder";
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
          name: this.folderName,
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
    this.token = String(useRoute().query.t || "");
    if (!this.token) {
      this.invalidToken = true;
      return;
    }
    this.loading = true;
    try {
      this.shareMeta = await ShareService.getMeta(this.token);
      this.folders = await ShareService.getFolders(this.token);
      this.currentFolder = this.shareRoot;
      if (!this.currentFolder) {
        this.invalidToken = true;
        return;
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
      if (!this.currentFolder) return;
      if (reset) {
        this.currentPage = 0;
        this.files = [];
      }
      const result = await ShareService.getFiles(
        this.token,
        this.currentFolder.id,
        {
          page: this.currentPage,
          pageSize: this.pageSize,
          sortOrder: "desc",
          includeSubFolders: false,
        },
      );
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
    focusGalleryItem(file) {
      this.displayFullScreen = true;
      this.positionFocus = this.files.findIndex((f) => f.id === file.id);
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
}
.share-expiry {
  font-size: var(--font-sm);
  opacity: 0.6;
  font-weight: normal;
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
