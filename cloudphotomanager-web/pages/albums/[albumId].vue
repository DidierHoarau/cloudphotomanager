<template>
  <div class="album-layout page">
    <div class="album-header">
      <div class="album-title-row">
        <NuxtLink to="/albums" class="album-back" aria-label="Back to albums">
          <i class="bi bi-arrow-left"></i>
        </NuxtLink>
        <h1 class="album-title">
          <i class="bi bi-collection"></i>
          {{ album.name || "Album" }}
        </h1>
        <small v-if="album.itemCount !== undefined" class="album-count">
          {{ album.itemCount }}
          {{ album.itemCount === 1 ? "photo" : "photos" }}
        </small>
      </div>
      <div class="album-actions">
        <NuxtLink to="/gallery" class="album-action-link">
          <i class="bi bi-plus-lg"></i> Add from gallery
        </NuxtLink>
        <button
          v-if="album.canEdit"
          class="secondary outline"
          @click="activeOperation = 'settings'"
        >
          <i class="bi bi-sliders"></i> Settings
        </button>
        <button
          v-if="authenticationStore.isAdmin"
          class="secondary outline"
          @click="activeOperation = 'share'"
        >
          <i class="bi bi-link-45deg"></i> Share
        </button>
      </div>
    </div>

    <div class="album-selection-actions">
      <kbd v-if="selectedFiles.length > 0">
        Selected: {{ selectedFiles.length }}
      </kbd>
      <button
        v-if="selectedFiles.length > 0"
        class="secondary outline"
        :disabled="bulkDownloading"
        @click="clickedDownload()"
      >
        <i class="bi bi-download"></i>
        {{ bulkDownloading ? "Zipping..." : "Download" }}
      </button>
      <button
        v-if="selectedFiles.length > 0 && album.canEdit"
        class="secondary outline"
        :disabled="removing"
        @click="clickedRemove()"
      >
        <i class="bi bi-collection"></i>
        {{ removing ? "Removing..." : "Remove from album" }}
      </button>
      <template v-if="selectedFiles.length === 1 && album.canEdit">
        <button
          class="secondary outline"
          :disabled="moving"
          @click="clickedMove('earlier')"
        >
          <i class="bi bi-arrow-left"></i> Earlier
        </button>
        <button
          class="secondary outline"
          :disabled="moving"
          @click="clickedMove('later')"
        >
          Later <i class="bi bi-arrow-right"></i>
        </button>
      </template>
      <span v-if="album.orderMode === 'manual'" class="album-order-badge">
        <i class="bi bi-list-ol"></i> Manual order
      </span>
    </div>

    <div class="album-file-list">
      <Loading v-if="loading" />
      <template v-else>
        <div v-if="files.length === 0" class="album-empty-state">
          <i class="bi bi-images"></i>
          <p>This album is empty.</p>
          <NuxtLink to="/gallery" class="album-empty-link">
            <i class="bi bi-plus-lg"></i> Add photos from the gallery
          </NuxtLink>
        </div>
        <template v-else>
          <Gallery
            :files="files"
            :selectedFiles="selectedFiles"
            :enableSelection="true"
            :showFolder="true"
            @focusGalleryItem="focusGalleryItem"
            @onFileSelected="onFileSelected"
          />
          <button
            v-if="hasMore"
            class="secondary outline album-more-btn"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? "Loading..." : "Load more" }}
          </button>
        </template>
      </template>
    </div>

    <GalleryItemFocus
      v-if="displayFullScreen"
      :galleryFiles="files"
      :initialPosition="positionFocus"
      :selectedFiles="selectedFiles"
      class="album-item-focus"
      @onFileClosed="displayFullScreen = false"
      @onFileSelected="onFileSelected"
    />
    <DialogAlbumSettings
      v-if="activeOperation === 'settings'"
      :album="album"
      @onUpdated="onAlbumUpdated"
      @onDeleted="onAlbumDeleted"
      @onDone="activeOperation = ''"
    />
    <DialogShareActions
      v-if="activeOperation === 'share'"
      :accountId="accountId"
      scope="album"
      :scopeId="albumId"
      :targetName="album.name || ''"
      @onDone="activeOperation = ''"
    />
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import { findIndex } from "lodash";
import { AlbumService } from "~~/services/AlbumService";
import { BulkDownloadService } from "~~/services/BulkDownloadService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { localCache, TTL } from "~~/services/LocalCache";

const PAGE_SIZE = 100;

export default {
  data() {
    return {
      albumId: "",
      accountId: "",
      album: {},
      files: [],
      selectedFiles: [],
      page: 0,
      hasMore: false,
      loading: false,
      loadingMore: false,
      bulkDownloading: false,
      removing: false,
      moving: false,
      displayFullScreen: false,
      positionFocus: 0,
      activeOperation: "",
      requestEtag: "",
    };
  },
  async created() {
    this.albumId = String(this.$route.params.albumId || "");
    this.accountId = String(this.$route.query.accountId || "");
    if (!this.albumId || !this.accountId) {
      this.$router.replace({ path: "/albums" });
      return;
    }
    // Show the cached first page immediately; the API replaces it below.
    const cached = await localCache.get(
      "albums",
      `album:${this.albumId}`,
      TTL.ALBUMS,
    );
    if (cached && cached.album && !this.album.id) {
      this.album = cached.album;
      this.files = cached.files || [];
      this.hasMore = !!cached.hasMore;
    }
    await this.fetchAlbum(true);
  },
  methods: {
    async fetchAlbum(initial = false) {
      if (initial && !this.album.id) {
        this.loading = true;
      }
      const requestEtag = new Date().toISOString();
      this.requestEtag = requestEtag;
      try {
        const album = await AlbumService.get(this.accountId, this.albumId);
        if (this.requestEtag !== requestEtag) return;
        this.album = album;
        await this.fetchItems(true);
        await this._cacheAlbum();
      } catch (err) {
        handleError(err);
        if (initial && !this.album.id) {
          this.$router.replace({ path: "/albums" });
        }
      } finally {
        if (initial && this.requestEtag === requestEtag) {
          this.loading = false;
        }
      }
    },
    async _cacheAlbum() {
      await localCache.put("albums", `album:${this.albumId}`, {
        album: this.album,
        files: this.files,
        hasMore: this.hasMore,
      });
    },
    async fetchItems(reset = false) {
      if (reset) {
        this.page = 0;
      }
      const result = await AlbumService.getItems(this.accountId, this.albumId, {
        page: this.page,
        pageSize: PAGE_SIZE,
        sortOrder: "desc",
      });
      const newFiles = result.files || [];
      this.files = reset ? newFiles : [...this.files, ...newFiles];
      this.hasMore = (result.total || 0) > this.files.length;
      this.album = { ...this.album, orderMode: result.orderMode };
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore) return;
      this.loadingMore = true;
      try {
        this.page += 1;
        await this.fetchItems();
      } catch (err) {
        this.page -= 1;
        handleError(err);
      } finally {
        this.loadingMore = false;
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
    async clickedDownload() {
      if (this.bulkDownloading) return;
      this.bulkDownloading = true;
      try {
        await BulkDownloadService.downloadZip(
          this.accountId,
          this.selectedFiles,
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Download started",
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.bulkDownloading = false;
      }
    },
    async clickedRemove() {
      if (this.removing || this.selectedFiles.length === 0) return;
      this.removing = true;
      try {
        const fileIds = this.selectedFiles.map((file) => file.id);
        await AlbumService.removeItems(this.accountId, this.albumId, fileIds);
        this.selectedFiles = [];
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Removed from album",
        });
        await this.fetchAlbum();
      } catch (err) {
        handleError(err);
      } finally {
        this.removing = false;
      }
    },
    async clickedMove(direction) {
      if (this.moving || this.selectedFiles.length !== 1) return;
      this.moving = true;
      try {
        await AlbumService.moveItem(
          this.accountId,
          this.albumId,
          this.selectedFiles[0].id,
          direction,
        );
        await this.fetchAlbum();
      } catch (err) {
        handleError(err);
      } finally {
        this.moving = false;
      }
    },
    focusGalleryItem(file) {
      if (!file) {
        this.displayFullScreen = false;
        return;
      }
      this.displayFullScreen = true;
      this.positionFocus = findIndex(this.files, { id: file.id });
    },
    onAlbumUpdated(album) {
      this.album = album;
    },
    onAlbumDeleted() {
      this.activeOperation = "";
      this.$router.replace({ path: "/albums" });
    },
  },
};
</script>

<style scoped>
.album-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: var(--space-sm);
  height: calc(var(--app-height, 100vh) - 4em);
  overflow: hidden;
}
.album-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.album-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.album-back {
  color: inherit;
  font-size: var(--font-lg);
  opacity: 0.7;
}
.album-back:hover {
  opacity: 1;
}
.album-title {
  margin: 0;
  font-size: var(--font-xl);
  word-break: break-word;
}
.album-count {
  opacity: 0.6;
  white-space: nowrap;
}
.album-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.album-actions button,
.album-action-link {
  width: auto;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: var(--font-base);
  text-decoration: none;
  cursor: pointer;
}
.album-actions button:hover,
.album-action-link:hover {
  background: var(--color-bg-hover);
}
.album-selection-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  min-height: 2.2em;
}
.album-selection-actions button {
  width: auto;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
}
.album-order-badge {
  font-size: var(--font-xs);
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.album-file-list {
  overflow: auto;
}
.album-more-btn {
  display: block;
  width: auto;
  margin: var(--space-base) auto;
}
.album-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-3xl) var(--space-base);
  opacity: 0.75;
  text-align: center;
}
.album-empty-state i {
  font-size: 3em;
}
.album-empty-state p {
  margin: 0;
}
.album-empty-link {
  color: var(--color-primary);
}
.album-item-focus {
  background-color: black;
  position: fixed;
  top: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  z-index: 100;
}
@media (max-width: 900px) {
  .album-layout {
    height: auto;
    overflow: visible;
  }
  .album-file-list {
    overflow: visible;
  }
}
</style>
