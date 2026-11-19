<template>
  <div class="albums-layout page">
    <header class="albums-header">
      <h1><i class="bi bi-collection"></i> Albums</h1>
      <p class="albums-hint">
        Curate photos from any folder. Files stay where they are.
      </p>
    </header>

    <div class="albums-toolbar">
      <label v-if="accounts.length > 1" class="albums-account">
        Account
        <select v-model="accountId" @change="onAccountChanged">
          <option v-for="account in accounts" :key="account.id" :value="account.id">
            {{ account.name }}
          </option>
        </select>
      </label>
      <form class="albums-create" @submit.prevent="createAlbum">
        <label class="albums-create-label">
          New album
          <input
            v-model="newAlbumName"
            type="text"
            maxlength="200"
            placeholder="Album name"
            required
          />
        </label>
        <button type="submit" :disabled="creating || !newAlbumName.trim()">
          <i class="bi bi-plus-lg"></i> Create
        </button>
      </form>
    </div>

    <Loading v-if="loading" />
    <div v-else-if="albums.length === 0" class="albums-empty">
      <i class="bi bi-collection"></i>
      <p>No albums yet. Create one and add photos from the gallery.</p>
    </div>
    <ul v-else class="albums-grid">
      <li v-for="album in albums" :key="album.id" class="album-card">
        <NuxtLink
          :to="{
            path: `/albums/${album.id}`,
            query: { accountId: album.accountId },
          }"
          class="album-card-link"
          :aria-label="`Open album ${album.name}`"
        >
          <div class="album-cover">
            <LazyMediaThumbnail v-if="album.cover" :file="album.cover" />
            <i v-else class="bi bi-images album-cover-placeholder"></i>
          </div>
          <div class="album-meta">
            <strong class="album-name">{{ album.name }}</strong>
            <small
              >{{ album.itemCount }}
              {{ album.itemCount === 1 ? "photo" : "photos" }}</small
            >
          </div>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<script>
import { AlbumService } from "~~/services/AlbumService";
import { handleError } from "~~/services/EventBus";
import { localCache, TTL } from "~~/services/LocalCache";

export default {
  data() {
    return {
      accountId: "",
      albums: [],
      loading: false,
      creating: false,
      newAlbumName: "",
    };
  },
  computed: {
    accounts() {
      return AccountsStore().accounts;
    },
  },
  async created() {
    const store = AccountsStore();
    await store.fetch();
    const requested = String(this.$route.query.accountId || "");
    this.accountId =
      requested && store.accounts.some((a) => a.id === requested)
        ? requested
        : store.accountSelected || store.accounts[0]?.id || "";
    await this.loadAlbums();
  },
  methods: {
    async loadAlbums() {
      if (!this.accountId) {
        this.albums = [];
        return;
      }
      const cacheKey = `list:${this.accountId}`;
      this.loading = true;
      // Hydrate from IndexedDB first so the list survives offline reloads.
      const cached = await localCache.get(
        "albums",
        cacheKey,
        TTL.ALBUMS,
      );
      if (Array.isArray(cached) && this.albums.length === 0) {
        this.albums = cached;
        this.loading = false;
      }
      try {
        this.albums = await AlbumService.list(this.accountId);
        await localCache.put("albums", cacheKey, this.albums);
      } catch (err) {
        if (!Array.isArray(cached)) {
          handleError(err);
        }
      } finally {
        this.loading = false;
      }
    },
    onAccountChanged() {
      this.albums = [];
      this.loadAlbums();
    },
    async createAlbum() {
      const name = this.newAlbumName.trim();
      if (!name || this.creating) return;
      this.creating = true;
      try {
        const album = await AlbumService.create(this.accountId, name);
        this.newAlbumName = "";
        this.$router.push({
          path: `/albums/${album.id}`,
          query: { accountId: album.accountId },
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.creating = false;
      }
    },
  },
};
</script>

<style scoped>
.albums-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}
.albums-header h1 {
  margin: 0;
}
.albums-hint {
  margin: var(--space-xs) 0 0 0;
  opacity: 0.7;
}
.albums-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-base);
}
.albums-account {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.albums-create {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  flex: 1;
  min-width: 16em;
}
.albums-create-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}
.albums-create button {
  width: auto;
  margin: 0;
}
.albums-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-3xl);
  opacity: 0.7;
  text-align: center;
}
.albums-empty i {
  font-size: 3em;
}
.albums-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12em, 1fr));
  gap: var(--space-base);
}
.album-card-link {
  display: block;
  color: inherit;
  text-decoration: none;
}
.album-cover {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.album-cover-placeholder {
  font-size: 3em;
  opacity: 0.35;
}
.album-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  padding-top: var(--space-xs);
}
.album-name {
  word-break: break-word;
}
.album-card-link:focus-visible .album-cover {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
