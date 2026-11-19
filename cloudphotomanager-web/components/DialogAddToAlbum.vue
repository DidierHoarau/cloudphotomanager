<template>
  <dialog open @keydown="onKeydown">
    <article ref="dialogArticle" tabindex="-1">
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          @click="clickedClose()"
        ></a>
        Add to Album
      </header>
      <p class="add-album-hint">
        <small>
          {{ files.length }}
          {{ files.length === 1 ? "file" : "files" }} stay in their folders.
        </small>
      </p>
      <Loading v-if="loading" />
      <template v-else>
        <ul v-if="albums.length > 0" class="add-album-list">
          <li v-for="album in albums" :key="album.id" class="add-album-item">
            <span class="add-album-name">{{ album.name }}</span>
            <button
              class="secondary outline add-album-btn"
              :disabled="busy"
              :aria-label="`Add to ${album.name}`"
              @click="addToAlbum(album)"
            >
              <i class="bi bi-plus-lg"></i> Add
            </button>
          </li>
        </ul>
        <p v-else class="add-album-hint"><small>No albums yet.</small></p>
        <form class="add-album-create" @submit.prevent="createAndAdd">
          <label>
            New album
            <input
              v-model="newAlbumName"
              ref="newAlbumInput"
              type="text"
              maxlength="200"
              placeholder="Album name"
            />
          </label>
          <button
            type="submit"
            class="secondary outline"
            :disabled="busy || !newAlbumName.trim()"
          >
            <i class="bi bi-collection"></i> Create and add
          </button>
        </form>
      </template>
      <footer>
        <button class="secondary outline" @click="clickedClose()">Close</button>
      </footer>
    </article>
  </dialog>
</template>

<script>
import { AlbumService } from "~~/services/AlbumService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";

export default {
  props: {
    files: {
      type: Array,
      required: true,
      default: () => [],
    },
  },
  data() {
    return {
      albums: [],
      loading: false,
      busy: false,
      newAlbumName: "",
      restoreFocusElement: null,
    };
  },
  computed: {
    accountId() {
      return this.files.find((file) => file && file.accountId)?.accountId || "";
    },
  },
  async created() {
    await this.loadAlbums();
  },
  mounted() {
    if (typeof document !== "undefined") {
      this.restoreFocusElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    this.$nextTick(() => dialogFocusFirst(this.$refs.dialogArticle));
  },
  beforeUnmount() {
    if (
      this.restoreFocusElement &&
      document.contains(this.restoreFocusElement)
    ) {
      this.restoreFocusElement.focus();
    }
  },
  methods: {
    async loadAlbums() {
      if (!this.accountId) {
        this.albums = [];
        return;
      }
      this.loading = true;
      try {
        this.albums = await AlbumService.list(this.accountId);
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    async addToAlbum(album) {
      if (this.busy) return;
      this.busy = true;
      try {
        await this._add(album);
      } catch (err) {
        handleError(err);
      } finally {
        this.busy = false;
      }
    },
    async _add(album) {
      const fileIds = this.files.map((file) => file.id);
      await AlbumService.addItems(this.accountId, album.id, fileIds);
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        text: `Added to album "${album.name}"`,
      });
      this.$emit("onDone", { albumId: album.id });
    },
    async createAndAdd() {
      const name = this.newAlbumName.trim();
      if (!name || this.busy || !this.accountId) return;
      this.busy = true;
      try {
        const album = await AlbumService.create(this.accountId, name);
        await this._add(album);
      } catch (err) {
        handleError(err);
      } finally {
        this.busy = false;
      }
    },
    clickedClose() {
      this.$emit("onDone", {});
    },
    onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.clickedClose();
        return;
      }
      dialogTrapFocus(event, this.$refs.dialogArticle);
    },
  },
};
</script>

<style scoped>
.add-album-hint {
  margin: 0 0 var(--space-sm) 0;
}
.add-album-list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-base) 0;
  max-height: 40vh;
  overflow-y: auto;
}
.add-album-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border-light);
}
.add-album-item:last-child {
  border-bottom: none;
}
.add-album-name {
  word-break: break-word;
}
.add-album-btn {
  width: auto;
  margin: 0;
}
.add-album-create {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
}
.add-album-create label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.add-album-create button {
  width: auto;
  margin: 0;
  white-space: nowrap;
}
footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-base);
}
</style>
