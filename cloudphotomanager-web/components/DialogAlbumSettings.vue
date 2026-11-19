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
        Album Settings
      </header>
      <template v-if="album.canEdit">
        <form class="album-settings-form" @submit.prevent="saveName">
          <label>
            Name
            <input
              v-model="name"
              type="text"
              maxlength="200"
              required
            />
          </label>
          <button type="submit" class="secondary outline" :disabled="saving">
            <i class="bi bi-check2"></i> Save name
          </button>
        </form>
        <label class="album-order">
          Order
          <select v-model="orderMode" :disabled="saving" @change="saveOrderMode">
            <option value="capture">Capture date</option>
            <option value="manual">Manual order</option>
          </select>
        </label>
        <p class="album-order-hint">
          <small>
            Manual order lets you move items earlier or later from the album
            view.
          </small>
        </p>
        <fieldset class="album-danger">
          <legend>Delete album</legend>
          <template v-if="confirmingDelete">
            <p class="album-delete-warning">
              <small>
                Delete "{{ album.name }}"? The photos stay in their folders.
              </small>
            </p>
            <div class="album-delete-actions">
              <button
                class="secondary outline"
                @click="confirmingDelete = false"
              >
                Cancel
              </button>
              <button :disabled="saving" @click="deleteAlbum()">
                <i class="bi bi-trash"></i> Delete album
              </button>
            </div>
          </template>
          <button
            v-else
            class="secondary outline"
            @click="confirmingDelete = true"
          >
            <i class="bi bi-trash"></i> Delete album...
          </button>
        </fieldset>
      </template>
      <p v-else class="album-settings-hint">
        Only the album owner or an administrator can change these settings.
      </p>
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
    album: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      name: this.album.name || "",
      orderMode: this.album.orderMode || "capture",
      saving: false,
      confirmingDelete: false,
      restoreFocusElement: null,
    };
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
    async saveName() {
      const name = this.name.trim();
      if (!name) return;
      await this._update({ name });
    },
    async saveOrderMode() {
      const previous = this.album.orderMode;
      try {
        await this._update({ orderMode: this.orderMode });
      } catch {
        this.orderMode = previous;
      }
    },
    async _update(patch) {
      if (this.saving) return;
      this.saving = true;
      try {
        const updated = await AlbumService.update(
          this.album.accountId,
          this.album.id,
          patch,
        );
        this.$emit("onUpdated", updated);
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Album updated" });
      } catch (err) {
        handleError(err);
        throw err;
      } finally {
        this.saving = false;
      }
    },
    async deleteAlbum() {
      if (this.saving) return;
      this.saving = true;
      try {
        await AlbumService.remove(this.album.accountId, this.album.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Album deleted" });
        this.$emit("onDeleted", this.album.id);
      } catch (err) {
        handleError(err);
      } finally {
        this.saving = false;
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
.album-settings-form {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  margin-bottom: var(--space-base);
}
.album-settings-form label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.album-settings-form button {
  width: auto;
  margin: 0;
}
.album-order {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.album-order select {
  width: auto;
  margin: 0;
}
.album-order-hint {
  margin: var(--space-xs) 0 var(--space-base) 0;
}
.album-danger {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
}
.album-danger legend {
  padding: 0 var(--space-xs);
  color: var(--color-danger);
}
.album-danger button {
  width: auto;
  margin: 0;
}
.album-delete-warning {
  margin: 0 0 var(--space-sm) 0;
}
.album-delete-actions {
  display: flex;
  gap: var(--space-sm);
}
.album-settings-hint {
  margin: 0;
}
footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-base);
}
</style>
