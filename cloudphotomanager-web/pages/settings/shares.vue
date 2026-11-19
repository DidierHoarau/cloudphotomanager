<template>
  <div class="shares-layout page">
    <TabNavigation :tabs="settingsTabs" />
    <div class="shares-header">
      <h4><i class="bi bi-link-45deg"></i> Public Share Links</h4>
      <p class="shares-hint">
        <small>
          Every active folder, album and single-file link. Revoking a link
          cuts access immediately; legacy links can be rotated to get a
          copyable URL.
        </small>
      </p>
    </div>
    <div v-if="!isAdmin" class="shares-state">
      <i class="bi bi-shield-lock"></i>
      <p>Only administrators can manage public share links.</p>
    </div>
    <template v-else>
      <div class="shares-filters">
        <label>
          Account
          <select v-model="accountFilter" @change="loadShares">
            <option value="">All accounts</option>
            <option
              v-for="account in accounts"
              :key="account.id"
              :value="account.id"
            >
              {{ account.name }}
            </option>
          </select>
        </label>
        <label>
          Type
          <select v-model="scopeFilter" @change="loadShares">
            <option value="">All types</option>
            <option value="folder">Folders</option>
            <option value="album">Albums</option>
            <option value="file">Files</option>
          </select>
        </label>
        <button
          class="secondary outline shares-refresh"
          :disabled="loading"
          aria-label="Refresh share links"
          @click="loadShares"
        >
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
      </div>
      <Loading v-if="loading" />
      <div v-else-if="shares.length === 0" class="shares-state">
        <i class="bi bi-link-slash"></i>
        <p>No active share links.</p>
      </div>
      <ul v-else class="shares-list">
        <li v-for="share in shares" :key="share.id" class="share-row">
          <div class="share-row-main">
            <span class="share-scope" :class="`share-scope-${share.scope}`">
              <i :class="scopeIcon(share.scope)" aria-hidden="true"></i>
              {{ share.scope }}
            </span>
            <strong class="share-target">{{
              share.targetName || "Unavailable target"
            }}</strong>
            <small class="share-account">{{
              accountName(share.accountId)
            }}</small>
          </div>
          <dl class="share-details">
            <div>
              <dt>Owner</dt>
              <dd>{{ share.ownerName || "Unknown" }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{{ formatDate(share.dateCreated) }}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>
                {{
                  share.dateExpires ? formatDate(share.dateExpires) : "Never"
                }}
              </dd>
            </div>
            <div>
              <dt>Last access</dt>
              <dd>
                {{
                  share.lastAccessDate
                    ? formatDate(share.lastAccessDate)
                    : "Never"
                }}
              </dd>
            </div>
          </dl>
          <div class="share-row-actions">
            <button
              v-if="share.sharePath"
              class="secondary outline share-action"
              :aria-label="`Copy link for ${share.targetName || share.scope}`"
              @click="copyShare(share)"
            >
              <i class="bi bi-clipboard"></i> Copy link
            </button>
            <button
              v-else
              class="secondary outline share-action"
              :disabled="rotatingShareId === share.id"
              :aria-label="`Rotate legacy link for ${share.targetName || share.scope}`"
              @click="rotateShare(share)"
            >
              <i class="bi bi-arrow-repeat"></i>
              {{ rotatingShareId === share.id ? "Rotating..." : "Rotate" }}
            </button>
            <button
              class="secondary outline share-action share-revoke"
              :disabled="revokingShareId === share.id"
              :aria-label="`Revoke link for ${share.targetName || share.scope}`"
              @click="revokeShare(share)"
            >
              <i class="bi bi-trash"></i>
              {{ revokingShareId === share.id ? "Revoking..." : "Revoke" }}
            </button>
          </div>
          <p v-if="share.legacy" class="share-legacy">
            <small>
              <i class="bi bi-exclamation-triangle"></i>
              Legacy link created before links were re-copyable. Rotate it to
              get a new URL; the old one stops working.
            </small>
          </p>
        </li>
      </ul>
    </template>
  </div>
</template>

<script>
import { ShareService } from "~~/services/ShareService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { getSettingsTabs } from "~~/utils/SettingsTabs";

export default {
  data() {
    return {
      settingsTabs: getSettingsTabs(),
      shares: [],
      loading: false,
      accountFilter: "",
      scopeFilter: "",
      revokingShareId: "",
      rotatingShareId: "",
    };
  },
  computed: {
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
    accounts() {
      return AccountsStore().accounts;
    },
  },
  async created() {
    await AuthenticationStore().ensureAuthenticated();
    if (!this.isAdmin) {
      this.$router.replace({ path: "/settings/profile" });
      return;
    }
    await AccountsStore().fetch();
    await this.loadShares();
  },
  methods: {
    async loadShares() {
      if (!this.isAdmin) return;
      this.loading = true;
      try {
        this.shares = await ShareService.listAll({
          accountId: this.accountFilter || undefined,
          scope: this.scopeFilter || undefined,
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    accountName(accountId) {
      const account = this.accounts.find((entry) => entry.id === accountId);
      return account ? account.name : "";
    },
    scopeIcon(scope) {
      if (scope === "album") return "bi bi-collection";
      if (scope === "file") return "bi bi-file-earmark-image";
      return "bi bi-folder2";
    },
    async copyShare(share) {
      if (!share.sharePath) return;
      const value = ShareService.buildShareUrl(
        ShareService.parseShareToken(share.sharePath),
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
    async rotateShare(share) {
      if (this.rotatingShareId) return;
      this.rotatingShareId = share.id;
      try {
        const rotated = await ShareService.rotate(share.id);
        await this.loadShares();
        const value = ShareService.buildShareUrl(
          ShareService.parseShareToken(rotated.sharePath),
        );
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
          }
        } catch {
          // Clipboard access is best effort; the new link is listed now.
        }
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Link rotated and copied",
        });
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
        this.shares = this.shares.filter((entry) => entry.id !== share.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, { text: "Share link revoked" });
      } catch (err) {
        handleError(err);
      } finally {
        this.revokingShareId = "";
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
.shares-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}
.shares-header h4 {
  margin: 0;
}
.shares-hint {
  margin: var(--space-xs) 0 0 0;
}
.shares-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-sm);
}
.shares-filters label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.shares-filters select {
  width: auto;
  margin: 0;
}
.shares-refresh {
  width: auto;
  margin: 0;
}
.shares-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-3xl) var(--space-base);
  opacity: 0.7;
  text-align: center;
}
.shares-state i {
  font-size: 3em;
}
.shares-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}
.share-row {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-base);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.share-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.share-scope {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-xs);
  text-transform: capitalize;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-bg-hover);
}
.share-target {
  word-break: break-word;
}
.share-account {
  opacity: 0.6;
}
.share-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10em, 1fr));
  gap: var(--space-sm);
  margin: 0;
}
.share-details div {
  min-width: 0;
}
.share-details dt {
  font-size: var(--font-xs);
  opacity: 0.6;
}
.share-details dd {
  margin: 0;
  font-size: var(--font-sm);
  word-break: break-word;
}
.share-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.share-action {
  width: auto;
  margin: 0;
}
.share-legacy {
  margin: 0;
  color: var(--color-warning);
}
</style>
