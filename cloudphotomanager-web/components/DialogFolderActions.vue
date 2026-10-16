<template>
  <dialog open>
    <article>
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedClose()"
        ></a>
        Folder Actions
      </header>
      <fieldset>
        <legend>Refresh Options</legend>
        <button class="secondary outline" v-on:click="doRefreshFolder()">
          <i class="bi bi-arrow-clockwise"></i> Refresh (Current Folder)
        </button>
        <button class="secondary outline" v-on:click="doDeepRefresh()">
          <i class="bi bi-arrow-repeat"></i> Refresh All (Deep Scan)
        </button>
      </fieldset>
      <fieldset v-if="!isRoot">
        <legend>Rename Folder</legend>
        <div v-if="!renameMode">
          <button class="secondary outline" v-on:click="startRename()">
            <i class="bi bi-pencil"></i> Rename...
          </button>
        </div>
        <div v-else class="rename-form">
          <input
            ref="renameInput"
            v-model="newName"
            type="text"
            placeholder="New folder name"
            v-on:keyup.enter="doRename()"
          />
          <div class="rename-actions">
            <button class="secondary" v-on:click="doRename()">
              <i class="bi bi-check2"></i> Save
            </button>
            <button class="secondary outline" v-on:click="cancelRename()">
              Cancel
            </button>
          </div>
        </div>
      </fieldset>
      <fieldset v-if="folder && folder.accountId && folder.id">
        <legend>Share Links</legend>
        <p class="share-hint">
          <small>
            Read-only link to this folder and its sub-folders. Anyone with the
            link can browse and download without an account.
          </small>
        </p>
        <div v-if="sharesLoading" class="share-loading">
          <Loading />
        </div>
        <template v-else>
          <ul v-if="shares.length > 0" class="share-list">
            <li v-for="share in shares" :key="share.id" class="share-item">
              <span class="share-item-dates">
                <small>
                  Created {{ formatDate(share.dateCreated) }} &middot;
                  <template v-if="share.dateExpires">
                    Expires {{ formatDate(share.dateExpires) }}
                  </template>
                  <template v-else> Never expires </template>
                </small>
              </span>
              <button
                class="secondary outline share-item-btn"
                :disabled="revokingShareId === share.id"
                v-on:click="doRevokeShare(share)"
                title="Revoke this share link"
              >
                <i class="bi bi-trash"></i> Revoke
              </button>
            </li>
          </ul>
          <p v-else class="share-hint"><small>No active share links.</small></p>
          <div
            v-if="createdShareUrl"
            class="share-created"
          >
            <input
              ref="shareUrlInput"
              :value="createdShareUrl"
              type="text"
              readonly
              class="share-url-input"
            />
            <div class="rename-actions">
              <button class="secondary" v-on:click="doCopyCreatedUrl()">
                <i class="bi bi-clipboard"></i> Copy URL
              </button>
              <button
                class="secondary outline"
                v-on:click="createdShareUrl = ''"
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
              v-on:click="doCreateShare()"
            >
              <i class="bi bi-link-45deg"></i>
              {{ creatingShare ? "Creating..." : "Create Link" }}
            </button>
          </div>
        </template>
      </fieldset>
      <footer>
        <button class="secondary outline" v-on:click="clickedClose()">
          Close
        </button>
      </footer>
    </article>
  </dialog>
</template>

<script>
import { ShareService } from "~~/services/ShareService";
import { handleError } from "~~/services/EventBus";

export default {
  props: {
    folder: {
      type: Object,
      required: true,
      default: () => ({}),
    },
  },
  data() {
    return {
      renameMode: false,
      newName: "",
      shares: [],
      sharesLoading: false,
      creatingShare: false,
      revokingShareId: "",
      expiresInDays: 30,
      createdShareUrl: "",
    };
  },
  computed: {
    isRoot() {
      return !this.folder || !this.folder.name || this.folder.parentIndex < 0;
    },
  },
  async created() {
    await this.loadShares();
  },
  methods: {
    clickedClose() {
      this.$emit("onDone", {});
    },
    doRefreshFolder() {
      this.$emit("onDone", { action: "refresh" });
    },
    doDeepRefresh() {
      this.$emit("onDone", { action: "deep-refresh" });
    },
    startRename() {
      this.newName = this.folder.name || "";
      this.renameMode = true;
      this.$nextTick(() => {
        if (this.$refs.renameInput) {
          this.$refs.renameInput.focus();
          this.$refs.renameInput.select?.();
        }
      });
    },
    cancelRename() {
      this.renameMode = false;
      this.newName = "";
    },
    doRename() {
      const trimmed = (this.newName || "").trim();
      if (!trimmed || trimmed === this.folder.name) {
        this.cancelRename();
        return;
      }
      if (trimmed.includes("/") || trimmed === "." || trimmed === "..") {
        return;
      }
      this.$emit("onDone", { action: "rename", newName: trimmed });
    },
    async loadShares() {
      if (!this.folder || !this.folder.accountId || !this.folder.id) {
        return;
      }
      this.sharesLoading = true;
      try {
        this.shares = await ShareService.list(
          this.folder.accountId,
          this.folder.id,
        );
      } catch (err) {
        handleError(err);
      } finally {
        this.sharesLoading = false;
      }
    },
    async doCreateShare() {
      if (this.creatingShare) return;
      this.creatingShare = true;
      try {
        const created = await ShareService.create(
          this.folder.accountId,
          this.folder.id,
          this.expiresInDays > 0 ? this.expiresInDays : undefined,
        );
        this._createdShareId = created.shareId;
        this.createdShareUrl = ShareService.buildShareUrl(
          created.sharePath.split("t=")[1] || "",
        );
        await this.loadShares();
      } catch (err) {
        handleError(err);
      } finally {
        this.creatingShare = false;
      }
    },
    async doRevokeShare(share) {
      if (this.revokingShareId) return;
      this.revokingShareId = share.id;
      try {
        await ShareService.revoke(
          this.folder.accountId,
          this.folder.id,
          share.id,
        );
        if (this.createdShareUrl && share.id === this._createdShareId) {
          this.createdShareUrl = "";
        }
        await this.loadShares();
      } catch (err) {
        handleError(err);
      } finally {
        this.revokingShareId = "";
      }
    },
    async doCopyCreatedUrl() {
      const value = this.createdShareUrl;
      if (!value) return;
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
      } catch (err) {
        handleError(err);
      }
    },
    formatDate(date) {
      if (!date) return "";
      return new Date(date).toLocaleString();
    },
  },
};
</script>

<style scoped>
fieldset {
  border: none;
  padding: var(--space-xs) 0;
}
button {
  display: block;
  margin-bottom: var(--space-sm);
  width: 100%;
}
.rename-form input {
  width: 100%;
  margin-bottom: var(--space-sm);
}
.rename-actions {
  display: flex;
  gap: var(--space-sm);
}
.rename-actions button {
  flex: 1;
  margin-bottom: 0;
}
footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
  margin-top: var(--space-base);
}
.share-hint {
  margin: 0 0 var(--space-sm) 0;
}
.share-list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-sm) 0;
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
.share-item-dates {
  opacity: 0.8;
}
.share-item-btn {
  width: auto;
  margin-bottom: 0;
}
.share-create {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.share-create button {
  width: auto;
  margin-bottom: 0;
}
.share-expiry-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
}
.share-expiry-select {
  width: auto;
  margin-bottom: 0;
}
.share-created input {
  width: 100%;
  margin-bottom: var(--space-xs);
  font-size: var(--font-xs);
}
.share-created .rename-actions button {
  width: auto;
  flex: none;
}
</style>
