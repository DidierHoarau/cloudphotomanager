<template>
  <div class="page page-queue">
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
    </div>
    <div class="queue-table">
      <Loading v-if="loading" />
      <table v-if="!loading && queueData.items.length > 0">
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
            v-for="(item, index) in queueData.items"
            :key="index"
            :class="{
              active: item.status === 'ACTIVE',
              waiting: item.status === 'WAITING',
            }"
          >
            <td>
              <kbd class="badge" :class="'status-' + item.status.toLowerCase()">
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
              <span v-if="item.dataInfo">{{
                item.dataInfo.name || item.dataInfo.id
              }}</span>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="!loading && queueData.items.length === 0" class="empty-state">
        <i class="bi bi-inbox"></i>
        <p>Queue is empty</p>
      </div>
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
        },
        items: [],
      },
    };
  },
  async created() {
    this.loading = true;
    await this.fetchQueue();
    this.loading = false;
    this.intervalId = setInterval(async () => {
      if (!this.loading) {
        await this.fetchQueue();
      }
    }, 10000);
  },
  beforeUnmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  },
  methods: {
    async fetchQueue() {
      try {
        const response = await axios.get(
          `${(await Config.get()).SERVER_URL}/sync/queue`,
          await AuthService.getAuthHeader()
        );

        const countsObj = {
          active: 0,
          waiting: 0,
        };

        if (response.data.counts) {
          response.data.counts.forEach((count) => {
            if (count.type === "ACTIVE") {
              countsObj.active = count.count;
            } else if (count.type === "WAITING") {
              countsObj.waiting = count.count;
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
.page-queue {
  display: grid;
  grid-template-rows: auto auto 1fr;
}

.queue-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1em;
}

.stat-card {
  padding: 1em;
  text-align: center;
}

.stat-label {
  opacity: 0.7;
  margin-bottom: 0.5em;
}

.stat-value {
  font-size: 1.3em;
  font-weight: bold;
}

.queue-table {
  overflow-x: auto;
}

tbody tr.active {
  background-color: rgba(25, 135, 84, 0.1);
}

tbody tr.waiting {
  background-color: rgba(255, 193, 7, 0.05);
}

.badge {
  display: inline-block;
  padding: 0.25em 0.75em;
  border-radius: 0.25em;
  font-size: 0.7em;
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
