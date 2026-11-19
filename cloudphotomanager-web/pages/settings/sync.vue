<template>
  <div class="page">
    <TabNavigation :tabs="settingsTabs" />
    <div class="queue-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'queue' }"
        @click="setTab('queue')"
      >
        Queue
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'failures' }"
        @click="setTab('failures')"
      >
        Failures
        <span v-if="failuresCount > 0" class="tab-badge">{{
          failuresCount
        }}</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'health' }"
        @click="setTab('health')"
      >
        Health
      </button>
    </div>

    <template v-if="activeTab === 'queue'">
      <div class="queue-stats">
        <div class="stat-card">
          <div class="stat-label">Active</div>
          <div class="stat-value">{{ displayCounts.active || 0 }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Waiting</div>
          <div class="stat-value">{{ displayCounts.waiting || 0 }}</div>
        </div>
      </div>
      <div class="queue-table">
        <Loading v-if="loading" />
        <div v-if="!loading && displayTruncated" class="queue-truncated-hint">
          Showing {{ resolvedItems.length }} of {{ displayTotalItems }} items
        </div>
        <table v-if="!loading && resolvedItems.length > 0">
          <thead>
            <tr>
              <td>Status</td>
              <td>Priority</td>
              <td>Account</td>
              <td>Function</td>
              <td>Item</td>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in resolvedItems"
              :key="index"
              :class="{
                active: item.status === 'ACTIVE',
                waiting: item.status === 'WAITING',
              }"
            >
              <td>
                <kbd
                  class="badge"
                  :class="'status-' + item.status.toLowerCase()"
                >
                  {{ item.status }}
                </kbd>
              </td>
              <td>
                <kbd
                  class="badge"
                  :class="
                    'priority-' + getPriorityLabel(item.priority).toLowerCase()
                  "
                >
                  {{ getPriorityLabel(item.priority) }}
                </kbd>
              </td>
              <td>{{ item.accountName }}</td>
              <td>
                <code>{{ item.functionName }}</code>
              </td>
              <td>
                <span v-if="item.label">{{ item.label }}</span>
                <span v-else>-</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="!loading && resolvedItems.length === 0" class="empty-state">
          <i class="bi bi-inbox"></i>
          <p>Queue is empty</p>
        </div>
      </div>
    </template>

    <template v-else-if="activeTab === 'failures'">
      <Loading v-if="failuresLoading" />
      <SyncFailuresList v-else :failures="failuresList" />
    </template>

    <template v-else>
      <div v-if="!isOnline" class="health-offline" role="status">
        <i class="bi bi-wifi-off"></i>
        Offline: the health data below may be stale and repair actions are
        disabled until the connection returns.
      </div>
      <Loading v-if="healthLoading && !health" />
      <div v-else-if="healthError" class="health-error" role="alert">
        <p>{{ healthError }}</p>
        <button type="button" class="secondary" @click="fetchHealth">
          Reload
        </button>
      </div>
      <template v-else-if="health">
        <section class="health-card">
          <h2>Label enrichment</h2>
          <div class="health-state">
            <kbd
              class="badge"
              :class="
                health.enrichment.enabled ? 'health-ok' : 'health-muted'
              "
            >
              {{ health.enrichment.enabled ? "Enabled" : "Disabled" }}
            </kbd>
            <kbd
              v-if="health.enrichment.circuitOpen"
              class="badge health-danger"
            >
              Model unavailable — retry in
              {{ health.enrichment.retryAfterSeconds }}s
            </kbd>
            <kbd
              v-else-if="health.enrichment.enabled"
              class="badge health-ok"
            >
              Model available
            </kbd>
          </div>
          <dl class="health-facts">
            <dt>Model source</dt>
            <dd>
              <code>{{ health.enrichment.modelSource || "unknown" }}</code>
            </dd>
            <dt>Model cache</dt>
            <dd>
              <code>{{ health.enrichment.cacheDir || "not configured" }}</code>
            </dd>
            <dt v-if="health.enrichment.consecutiveModelFailures > 0">
              Consecutive model failures
            </dt>
            <dd v-if="health.enrichment.consecutiveModelFailures > 0">
              {{ health.enrichment.consecutiveModelFailures }}
            </dd>
          </dl>
          <p v-if="health.enrichment.startupWarning" class="health-warning">
            <i class="bi bi-exclamation-triangle"></i>
            {{ health.enrichment.startupWarning }}
          </p>
          <p v-if="health.enrichment.lastModelError" class="health-warning">
            <i class="bi bi-exclamation-triangle"></i>
            Last model error<span
              v-if="health.enrichment.lastModelErrorAt"
              class="health-muted"
            >
              ({{ formatDate(health.enrichment.lastModelErrorAt) }})</span
            >: {{ health.enrichment.lastModelError }}
          </p>
        </section>

        <div class="queue-stats health-totals">
          <div class="stat-card">
            <div class="stat-label">Images</div>
            <div class="stat-value">{{ health.totals.totalImages }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Missing keywords</div>
            <div class="stat-value">{{ health.totals.missingKeywords }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Labels OK</div>
            <div class="stat-value">{{ health.totals.ok }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Failed</div>
            <div class="stat-value">{{ health.totals.failed }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending</div>
            <div class="stat-value">{{ health.totals.pending }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Disabled</div>
            <div class="stat-value">{{ health.totals.disabled }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">At media retry cap</div>
            <div class="stat-value">{{ health.totals.atRetryCap }}</div>
          </div>
        </div>

        <section v-if="health.lastEnrichmentError" class="health-card">
          <h2>Last enrichment error</h2>
          <p class="health-error-text">
            {{ health.lastEnrichmentError.error }}
          </p>
          <small>
            {{ accountNameFor(health.lastEnrichmentError.accountId) }} ·
            {{ formatDate(health.lastEnrichmentError.date) }}
          </small>
        </section>

        <section class="health-card">
          <h2>Files at the media retry cap</h2>
          <p class="health-muted">
            These files stopped retrying media previews. Enrichment retries
            never add files to this list.
          </p>
          <table v-if="health.retryCap.length > 0">
            <thead>
              <tr>
                <th scope="col">Cause</th>
                <th scope="col">Files</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(cause, index) in health.retryCap" :key="index">
                <td><code>{{ cause.cause }}</code></td>
                <td>{{ cause.count }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="health-muted">No files at the retry cap.</p>
        </section>

        <section v-if="health.oldestWaitingItem" class="health-card">
          <h2>Oldest waiting item</h2>
          <dl class="health-facts">
            <dt>Function</dt>
            <dd>
              <code>{{ health.oldestWaitingItem.functionName }}</code>
            </dd>
            <dt>Priority</dt>
            <dd>
              {{ getPriorityLabel(health.oldestWaitingItem.priority) }}
            </dd>
            <dt>Waiting since</dt>
            <dd>{{ formatDate(health.oldestWaitingItem.dateCreated) }}</dd>
          </dl>
        </section>

        <section class="health-card">
          <div class="health-card-header">
            <h2>Per-account enrichment</h2>
            <button
              type="button"
              :disabled="!canRetryEnrichment"
              :aria-label="retryAllAria"
              :title="retryAllTitle"
              @click="openRetryConfirm(null)"
            >
              <i
                class="bi"
                :class="
                  retryingHealth ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'
                "
              ></i>
              Retry enrichment
            </button>
          </div>
          <table v-if="health.accounts.length > 0">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Images</th>
                <th scope="col">Missing keywords</th>
                <th scope="col">OK</th>
                <th scope="col">Failed</th>
                <th scope="col">Pending</th>
                <th scope="col">Disabled</th>
                <th scope="col">At retry cap</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="account in health.accounts" :key="account.accountId">
                <td>{{ account.name }}</td>
                <td>{{ account.totalImages }}</td>
                <td>{{ account.missingKeywords }}</td>
                <td>{{ account.ok }}</td>
                <td>{{ account.failed }}</td>
                <td>{{ account.pending }}</td>
                <td>{{ account.disabled }}</td>
                <td>{{ account.atRetryCap }}</td>
                <td>
                  <button
                    type="button"
                    class="secondary outline health-retry-account"
                    :disabled="!canRetryEnrichment"
                    :aria-label="`Retry label enrichment for ${account.name}`"
                    @click="openRetryConfirm(account)"
                  >
                    Retry
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="health-muted">No accounts found.</p>
          <small class="health-generated">
            Generated at {{ formatDate(health.generatedAt) }}
          </small>
        </section>
      </template>
    </template>

    <div v-if="showRetryConfirm" class="confirm-overlay">
      <DialogConfirm
        title="Retry label enrichment"
        :message="retryConfirmMessage"
        @onConfirm="confirmRetry"
        @onCancel="showRetryConfirm = false"
      />
    </div>
  </div>
</template>

<script setup>
const syncStore = SyncStore();
const accountsStore = AccountsStore();
</script>

<script>
import axios from "axios";
import { find } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { getSettingsTabs } from "~~/utils/SettingsTabs";

export default {
  data() {
    return {
      settingsTabs: getSettingsTabs(),
      loading: false,
      failuresLoading: false,
      activeTab: "queue",
      httpItems: [],
      httpCounts: { active: 0, waiting: 0 },
      httpTotalItems: 0,
      httpTruncated: false,
      health: null,
      healthLoading: false,
      healthError: null,
      isOnline: true,
      showRetryConfirm: false,
      retryTarget: null,
      retryingHealth: false,
    };
  },
  computed: {
    resolvedItems() {
      const accounts = AccountsStore().accounts || [];
      const rawItems = SyncStore().wsConnected
        ? SyncStore().queueItems
        : this.httpItems;
      const mapped = rawItems.map((item) => {
        const account = find(accounts, { id: item.accountId });
        return {
          ...item,
          accountName: account ? account.name : item.accountId,
        };
      });
      // Always show ACTIVE items on top, then WAITING, preserving server order within each group
      const active = mapped.filter((i) => i.status === "ACTIVE");
      const others = mapped.filter((i) => i.status !== "ACTIVE");
      return [...active, ...others];
    },
    displayCounts() {
      if (SyncStore().wsConnected) {
        let active = 0;
        let waiting = 0;
        for (const c of SyncStore().counts) {
          if (c.type === "ACTIVE") active = c.count;
          else if (c.type === "WAITING") waiting = c.count;
        }
        return { active, waiting };
      }
      return this.httpCounts;
    },
    displayTotalItems() {
      return SyncStore().wsConnected
        ? SyncStore().queueTotalItems
        : this.httpTotalItems;
    },
    displayTruncated() {
      return SyncStore().wsConnected
        ? SyncStore().queueTruncated
        : this.httpTruncated;
    },
    failuresList() {
      const accounts = AccountsStore().accounts || [];
      return (SyncStore().failures || []).map((failure) => {
        if (failure.accountName) return failure;
        // Records written before the server resolved the account name:
        // fall back to the accounts list so the card still shows it.
        const account = find(accounts, { id: failure.accountId });
        return {
          ...failure,
          accountName: account ? account.name : failure.accountId,
        };
      });
    },
    failuresCount() {
      return SyncStore().failuresCount || 0;
    },
    canRetryEnrichment() {
      return (
        this.isOnline &&
        !!this.health &&
        this.health.enrichment.enabled &&
        !this.retryingHealth
      );
    },
    retryAllAria() {
      if (!this.isOnline) {
        return "Retry label enrichment (offline)";
      }
      return this.retryingHealth
        ? "Retrying label enrichment"
        : "Retry label enrichment for the whole library";
    },
    retryAllTitle() {
      if (!this.isOnline) {
        return "Unavailable while offline";
      }
      if (!this.health || !this.health.enrichment.enabled) {
        return "Image classification is disabled (IMAGE_CLASSIFICATION_ENABLED=N)";
      }
      return "Re-queue every image that is missing labels";
    },
    retryConfirmMessage() {
      if (this.retryTarget) {
        return `Re-queue label enrichment for images missing labels in the account "${this.retryTarget.name}"? Files already labeled are not touched.`;
      }
      return "Re-queue label enrichment for every image missing labels (failed, pending, or never attempted) across the whole library? Files already labeled are not touched.";
    },
  },
  watch: {
    "$route.query.tab"(tab) {
      if (tab === "failures") {
        if (this.activeTab !== "failures") {
          this.activeTab = "failures";
          SyncStore().fetchFailures();
        }
      } else if (tab === "health") {
        if (this.activeTab !== "health") {
          this.activeTab = "health";
          this.fetchHealth();
        }
      } else if (this.activeTab === "failures" || this.activeTab === "health") {
        this.activeTab = "queue";
      }
    },
    isOnline(online) {
      if (online && this.activeTab === "health") {
        this.fetchHealth();
      }
    },
  },
  async created() {
    if (typeof navigator !== "undefined") {
      this.isOnline = navigator.onLine;
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onNetworkOnline);
      window.addEventListener("offline", this.onNetworkOffline);
    }
    await AccountsStore().fetch();
    const queryTab = this.$route.query && this.$route.query.tab;
    if (queryTab === "failures" || queryTab === "health") {
      this.activeTab = queryTab;
    }
    this.loading = true;
    await this.fetchQueue();
    this.loading = false;
    this.failuresLoading = true;
    await SyncStore().fetchFailures();
    this.failuresLoading = false;
    if (this.activeTab === "health") {
      await this.fetchHealth();
    }
    this.intervalId = setInterval(async () => {
      if (!this.loading) {
        await this.fetchQueue();
      }
      if (!SyncStore().wsConnected) {
        await SyncStore().fetchFailures();
      }
      if (this.activeTab === "health") {
        await this.fetchHealth();
      }
    }, 5000);
  },
  beforeUnmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onNetworkOnline);
      window.removeEventListener("offline", this.onNetworkOffline);
    }
  },
  methods: {
    onNetworkOnline() {
      this.isOnline = true;
    },
    onNetworkOffline() {
      this.isOnline = false;
    },
    setTab(tab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      const query = { ...this.$route.query };
      if (tab === "failures" || tab === "health") {
        query.tab = tab;
      } else {
        delete query.tab;
      }
      this.$router.replace({ query });
      if (tab === "failures") {
        SyncStore().fetchFailures();
      } else if (tab === "health") {
        this.fetchHealth();
      }
    },
    async fetchHealth() {
      if (!this.isOnline && this.health) {
        // Keep the last known snapshot visible while offline.
        return;
      }
      if (this.healthLoading) {
        return;
      }
      this.healthLoading = true;
      try {
        const response = await axios.get(
          `${(await Config.get()).SERVER_URL}/sync/health`,
          await AuthService.getAuthHeader(),
        );
        this.health = response.data;
        this.healthError = null;
      } catch (err) {
        this.healthError =
          (err && err.response && err.response.data && err.response.data.error) ||
          (err && err.message) ||
          "Unable to load the library health";
      } finally {
        this.healthLoading = false;
      }
    },
    accountNameFor(accountId) {
      const account =
        this.health &&
        this.health.accounts.find((entry) => entry.accountId === accountId);
      return account ? account.name : accountId;
    },
    formatDate(value) {
      if (!value) return "unknown";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    },
    openRetryConfirm(account) {
      if (!this.canRetryEnrichment) return;
      this.retryTarget = account || null;
      this.showRetryConfirm = true;
    },
    async confirmRetry() {
      this.showRetryConfirm = false;
      const target = this.retryTarget;
      this.retryTarget = null;
      if (!this.isOnline || !this.health || !this.health.enrichment.enabled) {
        return;
      }
      this.retryingHealth = true;
      try {
        const response = await axios.post(
          `${(await Config.get()).SERVER_URL}/sync/enrichment/retry`,
          target ? { accountId: target.accountId } : {},
          await AuthService.getAuthHeader(),
        );
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: `Enrichment retry queued ${response.data.queued} of ${response.data.matched} matching files`,
        });
        await this.fetchHealth();
      } catch (err) {
        handleError(err);
      } finally {
        this.retryingHealth = false;
      }
    },
    async fetchQueue() {
      try {
        const response = await axios.get(
          `${(await Config.get()).SERVER_URL}/sync/queue`,
          await AuthService.getAuthHeader(),
        );

        const countsObj = { active: 0, waiting: 0 };
        if (response.data.counts) {
          response.data.counts.forEach((count) => {
            if (count.type === "ACTIVE") countsObj.active = count.count;
            else if (count.type === "WAITING") countsObj.waiting = count.count;
          });
        }

        this.httpCounts = countsObj;
        this.httpItems = response.data.items || [];
        this.httpTotalItems =
          typeof response.data.totalItems === "number"
            ? response.data.totalItems
            : countsObj.active + countsObj.waiting;
        this.httpTruncated = !!response.data.truncated;
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
    getPriorityLabel(priority) {
      switch (priority) {
        case 1:
          return "Interactive";
        case 2:
          return "Normal";
        case 3:
          return "Batch";
        default:
          return "Unknown";
      }
    },
  },
};
</script>

<style scoped>
.queue-tabs {
  display: flex;
  gap: var(--space-xs);
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  margin-bottom: var(--space-md);
}
.tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: var(--space-sm) var(--space-base);
  cursor: pointer;
  font-size: var(--font-lg);
  color: inherit;
  opacity: 0.7;
}
.tab-btn.active {
  opacity: 1;
  border-bottom-color: currentColor;
  font-weight: 500;
}
.tab-btn:hover {
  opacity: 1;
}
.tab-badge {
  display: inline-block;
  margin-left: var(--space-sm);
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: var(--color-text-inverse);
  font-size: var(--font-sm);
  font-weight: 600;
}

.queue-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-base);
}

.stat-card {
  padding: var(--space-base);
  text-align: center;
}

.stat-label {
  opacity: 0.7;
  margin-bottom: var(--space-sm);
}

.stat-value {
  font-size: var(--font-xl);
  font-weight: bold;
}

.queue-table {
  overflow-x: auto;
}

.queue-truncated-hint {
  margin: var(--space-sm) 0;
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-base);
  opacity: 0.75;
  border-left: 3px solid rgba(13, 110, 253, 0.5);
  background: rgba(13, 110, 253, 0.08);
  border-radius: var(--radius-sm);
}

tbody tr.active {
  background-color: rgba(25, 135, 84, 0.1);
}

tbody tr.waiting {
  background-color: rgba(255, 193, 7, 0.05);
}

.badge {
  display: inline-block;
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 500;
}

.status-active {
  background-color: rgba(25, 135, 84, 0.2);
  color: var(--color-success);
}

.status-waiting {
  background-color: rgba(255, 193, 7, 0.2);
  color: var(--color-warning);
}

.priority-interactive {
  background-color: rgba(220, 53, 69, 0.2);
  color: var(--color-danger);
}

.priority-normal {
  background-color: rgba(13, 110, 253, 0.2);
  color: var(--color-primary);
}

.priority-batch {
  background-color: rgba(108, 117, 125, 0.2);
  color: var(--color-text-muted);
}

code {
  background: rgba(0, 0, 0, 0.1);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--font-body);
}

.empty-state {
  text-align: center;
  padding: var(--space-3xl);
  opacity: 0.5;
}

.empty-state i {
  font-size: 4em;
  margin-bottom: var(--space-sm);
}

small {
  opacity: 0.6;
  font-size: var(--font-base);
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay);
}

.health-offline,
.health-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-md);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-warning);
  background: rgba(253, 126, 20, 0.1);
}

.health-error {
  border-left-color: var(--color-danger);
  background: var(--color-danger-bg);
  flex-wrap: wrap;
}

.health-error p {
  margin: 0;
  flex: 1;
}

.health-card {
  padding: var(--space-base);
  margin-bottom: var(--space-base);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}

.health-card h2 {
  font-size: var(--font-lg);
  margin: 0 0 var(--space-sm) 0;
}

.health-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.health-card-header h2 {
  margin: 0;
}

.health-state {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.health-ok {
  background-color: rgba(67, 160, 71, 0.2);
  color: var(--color-success);
}

.health-danger {
  background-color: rgba(220, 53, 69, 0.2);
  color: var(--color-danger);
}

.health-muted {
  color: var(--color-text-muted);
}

.health-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-base);
  margin: 0;
}

.health-facts dt {
  font-weight: 600;
}

.health-facts dd {
  margin: 0;
  word-break: break-all;
}

.health-warning {
  margin: var(--space-sm) 0 0 0;
  color: var(--color-warning);
}

.health-error-text {
  margin: 0 0 var(--space-xs) 0;
  word-break: break-word;
}

.health-totals {
  margin-bottom: var(--space-base);
}

.health-retry-account {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-sm);
}

.health-generated {
  display: block;
  margin-top: var(--space-sm);
  opacity: 0.6;
  font-size: var(--font-sm);
}
</style>
