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

    <template v-else>
      <Loading v-if="failuresLoading" />
      <SyncFailuresList v-else :failures="failuresList" />
    </template>
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
import { handleError } from "~~/services/EventBus";

export default {
  data() {
    return {
      settingsTabs: [
        {
          id: "accounts",
          label: "Accounts",
          to: "/settings/accounts",
        },
        {
          id: "sync",
          label: "Sync Queue",
          to: "/settings/sync",
        },
        {
          id: "users",
          label: "Users",
          to: "/settings/users",
        },
      ],
      loading: false,
      failuresLoading: false,
      activeTab: "queue",
      httpItems: [],
      httpCounts: { active: 0, waiting: 0 },
      httpTotalItems: 0,
      httpTruncated: false,
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
      return SyncStore().failures || [];
    },
    failuresCount() {
      return SyncStore().failuresCount || 0;
    },
  },
  async created() {
    await AccountsStore().fetch();
    const queryTab = this.$route.query && this.$route.query.tab;
    if (queryTab === "failures") {
      this.activeTab = "failures";
    }
    this.loading = true;
    await this.fetchQueue();
    this.loading = false;
    this.failuresLoading = true;
    await SyncStore().fetchFailures();
    this.failuresLoading = false;
    this.intervalId = setInterval(async () => {
      if (!this.loading) {
        await this.fetchQueue();
      }
      if (!SyncStore().wsConnected) {
        await SyncStore().fetchFailures();
      }
    }, 5000);
  },
  beforeUnmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  },
  methods: {
    setTab(tab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      const query = { ...(this.$route.query || {}) };
      if (tab === "failures") {
        query.tab = "failures";
      } else {
        delete query.tab;
      }
      this.$router.replace({ query });
      if (tab === "failures") {
        SyncStore().fetchFailures();
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
</style>
