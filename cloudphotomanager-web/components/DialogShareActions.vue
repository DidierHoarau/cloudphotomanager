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
        Share {{ scopeLabel }}
      </header>
      <p class="share-hint">
        <small>
          Read-only public link{{ scope === "folder" ? " to this folder and its sub-folders" : "" }}.
          Anyone with the link can browse and download without an account.
        </small>
      </p>
      <p v-if="!isAdmin" class="share-hint">
        <small>Only administrators can manage share links.</small>
      </p>
      <template v-else>
        <Loading v-if="loading" />
        <template v-else>
          <ul v-if="shares.length > 0" class="share-list">
            <li v-for="share in shares" :key="share.id" class="share-item">
              <div class="share-item-info">
                <small>
                  Created {{ formatDate(share.dateCreated) }} &middot;
                  <template v-if="share.dateExpires">
                    expires {{ formatDate(share.dateExpires) }}
                  </template>
                  <template v-else> never expires </template>
                  <template v-if="share.lastAccessDate">
                    &middot; last opened {{ formatDate(share.lastAccessDate) }}
                  </template>
                </small>
                <small v-if="share.legacy" class="share-legacy">
                  Legacy link: rotate it to copy a new URL (the old one stops
                  working).
                </small>
              </div>
              <div class="share-item-actions">
                <button
                  v-if="share.sharePath"
                  class="secondary outline share-item-btn"
                  :aria-label="`Copy link for ${scopeLabel}`"
                  @click="copyUrl(share.sharePath)"
                >
                  <i class="bi bi-clipboard"></i> Copy
                </button>
                <button
                  v-else
                  class="secondary outline share-item-btn"
                  :disabled="rotatingShareId === share.id"
                  :aria-label="`Rotate link for ${scopeLabel}`"
                  @click="rotateShare(share)"
                >
                  <i class="bi bi-arrow-repeat"></i>
                  {{ rotatingShareId === share.id ? "Rotating..." : "Rotate" }}
                </button>
                <button
                  class="secondary outline share-item-btn"
                  :disabled="revokingShareId === share.id"
                  :aria-label="`Revoke link for ${scopeLabel}`"
                  @click="revokeShare(share)"
                >
                  <i class="bi bi-trash"></i>
                  {{ revokingShareId === share.id ? "Revoking..." : "Revoke" }}
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="share-hint"><small>No active share links.</small></p>
          <div v-if="createdShareUrl" class="share-created">
            <label class="share-created-label">
              New link
              <input
                ref="shareUrlInput"
                :value="createdShareUrl"
                type="text"
                readonly
                @focus="$event.target.select()"
              />
            </label>
            <div class="share-created-actions">
              <button class="secondary" @click="copyUrl(createdShareUrl)">
                <i class="bi bi-clipboard"></i> Copy URL
              </button>
              <button
                class="secondary outline"
                @click="createdShareUrl = ''"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div v-else class="share-create">
            <label class="share-expiry-label">
              Expires after
              <select v-model="expiresInDays" class="share-expiry-select">
                <option :value="7">7 days</option>
                <option :value="30">30 days</option>
                <option :value="0">Never</option>
              </select>
            </label>
            <button
              class="secondary outline"
              :disabled="creatingShare"
              @click="createShare()"
            >
              <i class="bi bi-link-45deg"></i>
              {{ creatingShare ? "Creating..." : "Create Link" }}
            </button>
          </div>
        </template>
      </template>
      <footer>
        <button class="secondary outline" @click="clickedClose()">Close</button>
      </footer>
    </article>
  </dialog>
</template>

<script>
import { ShareService } from "~~/services/ShareService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";

export default {
  props: {
    accountId: {
      type: String,
      required: true,
    },
    scope: {
      type: String,
      required: true,
      validator: (value) => ["folder", "album", "file"].includes(value),
    },
    scopeId: {
      type: String,
      required: true,
    },
    targetName: {
      type: String,
      default: "",
    },
  },
  data() {
    return {
      shares: [],
      loading: false,
      creatingShare: false,
      revokingShareId: "",
      rotatingShareId: "",
      expiresInDays: 30,
      createdShareUrl: "",
      restoreFocusElement: null,
    };
  },
  computed: {
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
    scopeLabel() {
      if (this.scope === "album") {
        return this.targetName ? `album "${this.targetName}"` : "album";
      }
      if (this.scope === "file") {
        return this.targetName ? `file "${this.targetName}"` : "file";
      }
      return this.targetName ? `folder "${this.targetName}"` : "folder";
    },
  },
  async created() {
    await this.loadShares();
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
    async loadShares() {
      if (!this.isAdmin) return;
      this.loading = true;
      try {
        this.shares = await ShareService.listAll({
          accountId: this.accountId,
          scope: this.scope,
          scopeId: this.scopeId,
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    async createShare() {
      if (this.creatingShare) return;
      this.creatingShare = true;
      try {
        const created = await ShareService.createForScope({
          accountId: this.accountId,
          scope: this.scope,
          scopeId: this.scopeId,
          expiresInDays: this.expiresInDays > 0 ? this.expiresInDays : undefined,
        });
        this.createdShareUrl = ShareService.buildShareUrl(
          ShareService.parseShareToken(created.sharePath),
        );
        await this.loadShares();
      } catch (err) {
        handleError(err);
      } finally {
        this.creatingShare = false;
      }
    },
    async rotateShare(share) {
      if (this.rotatingShareId) return;
      this.rotatingShareId = share.id;
      try {
        const rotated = await ShareService.rotate(share.id);
        this.createdShareUrl = ShareService.buildShareUrl(
          ShareService.parseShareToken(rotated.sharePath),
        );
        await this.loadShares();
      } catch (err) {
        handleError(err);
      } finally {
        this.rotatingShareId = "";
      }
    },
    async revokeShare(share) {
      if (this.revokingShareId) return;
      this.revokingShareId = share.id;
      try {
        await ShareService.revokeById(share.id);
        await this.loadShares();
      } catch (err) {
        handleError(err);
      } finally {
        this.revokingShareId = "";
      }
    },
    async copyUrl(sharePath) {
      if (!sharePath) return;
      const value = ShareService.buildShareUrl(
        ShareService.parseShareToken(sharePath),
      );
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Share link copied" });
      } catch (err) {
        handleError(err);
      }
    },
    formatDate(date) {
      if (!date) return "";
      return new Date(date).toLocaleString();
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
.share-hint {
  margin: 0 0 var(--space-sm) 0;
}
.share-list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-sm) 0;
  max-height: 40vh;
  overflow-y: auto;
}
.share-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border-light);
}
.share-item:last-child {
  border-bottom: none;
}
.share-item-info {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  opacity: 0.85;
}
.share-legacy {
  color: var(--color-warning);
}
.share-item-actions {
  display: flex;
  gap: var(--space-xs);
  flex-shrink: 0;
}
.share-item-btn {
  width: auto;
  margin: 0;
}
.share-created-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.share-created input {
  width: 100%;
  font-size: var(--font-xs);
}
.share-created-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.share-created-actions button {
  width: auto;
  margin: 0;
}
.share-create {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.share-create button {
  width: auto;
  margin: 0;
}
.share-expiry-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
}
.share-expiry-select {
  width: auto;
  margin: 0;
}
footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-base);
}
@media (max-width: 600px) {
  .share-item {
    flex-direction: column;
    align-items: flex-start;
  }
  .share-create {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
