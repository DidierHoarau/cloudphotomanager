<template>
  <div class="page">
    <h1>Sync Queue</h1>
    <div class="queue-stats">
      <div class="stat-card">
        <div class="stat-label">Active</div>
        <div class="stat-value">{{ queueData.counts.active || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Waiting</div>
        <div class="stat-value">{{ queueData.counts.waiting || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Blocking</div>
        <div class="stat-value">{{ queueData.counts.blocking || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total</div>
        <div class="stat-value">{{ queueData.items.length }}</div>
      </div>
    </div>

    <div class="actions page-actions">
      <button @click="fetchQueue" :disabled="loading">
        <i class="bi bi-arrow-clockwise"></i> Refresh
      </button>
    </div>

    <Loading v-if="loading" />

    <div v-if="!loading && queueData.items.length > 0" class="queue-table">
      <table>
        <thead>
          <tr>
            <td>Status</td>
            <td>Priority</td>
            <td>Account</td>
            <td>Function</td>
            <td>Item</td>
            <td>ID</td>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in queueData.items"
            :key="index"
            :class="{
              active: item.status === 'ACTIVE',
              waiting: item.status === 'WAITING',
            }"
          >
            <td>
              <span
                class="badge"
                :class="'status-' + item.status.toLowerCase()"
              >
                {{ item.status }}
              </span>
            </td>
            <td>
              <span
                class="badge"
                :class="
                  'priority-' + getPriorityLabel(item.priority).toLowerCase()
                "
              >
                {{ getPriorityLabel(item.priority) }}
              </span>
            </td>
            <td>{{ item.accountName }}</td>
            <td>
              <code>{{ item.functionName }}</code>
            </td>
            <td>
              <span v-if="item.dataInfo">{{
                item.dataInfo.name || item.dataInfo.id
              }}</span>
              <span v-else>-</span>
            </td>
            <td>
              <small>{{ item.id }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!loading && queueData.items.length === 0" class="empty-state">
      <i class="bi bi-inbox"></i>
      <p>Queue is empty</p>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";

export default {
  data() {
    return {
      loading: false,
      queueData: {
        counts: {
          active: 0,
          waiting: 0,
          blocking: 0,
        },
        items: [],
      },
    };
  },
  async created() {
    await this.fetchQueue();
    // Auto-refresh every 5 seconds
    this.intervalId = setInterval(async () => {
      if (!this.loading) {
        await this.fetchQueue();
      }
    }, 5000);
  },
  beforeUnmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  },
  methods: {
    async fetchQueue() {
      this.loading = true;
      try {
        const response = await axios.get(
          `${(await Config.get()).SERVER_URL}/sync/queue`,
          await AuthService.getAuthHeader()
        );

        // Transform counts array to object
        const countsObj = {
          active: 0,
          waiting: 0,
          blocking: 0,
        };

        if (response.data.counts) {
          response.data.counts.forEach((count) => {
            if (count.type === "ACTIVE") {
              countsObj.active = count.count;
            } else if (count.type === "WAITING") {
              countsObj.waiting = count.count;
            } else if (count.type === "blocking") {
              countsObj.blocking = count.count;
            }
          });
        }

        this.queueData = {
          counts: countsObj,
          items: response.data.items || [],
        };
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
h1 {
  margin-bottom: 1.5em;
}

.queue-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1em;
  margin-bottom: 2em;
}

.stat-card {
  background: var(--bs-body-bg);
  border: 1px solid var(--bs-border-color);
  border-radius: 0.5em;
  padding: 1em;
  text-align: center;
}

.stat-label {
  font-size: 0.9em;
  opacity: 0.7;
  margin-bottom: 0.5em;
}

.stat-value {
  font-size: 2em;
  font-weight: bold;
}

.page-actions {
  margin-bottom: 1.5em;
}

.page-actions button {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
}

.queue-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead td {
  font-weight: bold;
  border-bottom: 2px solid var(--bs-border-color);
  padding: 0.75em;
}

tbody tr {
  border-bottom: 1px solid var(--bs-border-color);
}

tbody tr.active {
  background-color: rgba(25, 135, 84, 0.1);
}

tbody tr.waiting {
  background-color: rgba(255, 193, 7, 0.05);
}

tbody td {
  padding: 0.75em;
}

.badge {
  display: inline-block;
  padding: 0.25em 0.75em;
  border-radius: 0.25em;
  font-size: 0.85em;
  font-weight: 500;
}

.status-active {
  background-color: rgba(25, 135, 84, 0.2);
  color: #198754;
}

.status-waiting {
  background-color: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.priority-interactive {
  background-color: rgba(220, 53, 69, 0.2);
  color: #dc3545;
}

.priority-normal {
  background-color: rgba(13, 110, 253, 0.2);
  color: #0d6efd;
}

.priority-batch {
  background-color: rgba(108, 117, 125, 0.2);
  color: #6c757d;
}

code {
  background: rgba(0, 0, 0, 0.1);
  padding: 0.2em 0.4em;
  border-radius: 0.2em;
  font-size: 0.9em;
}

.empty-state {
  text-align: center;
  padding: 3em;
  opacity: 0.5;
}

.empty-state i {
  font-size: 4em;
  margin-bottom: 0.5em;
}

small {
  opacity: 0.6;
  font-size: 0.8em;
}
</style>
