<template>
  <div class="sync-center-panel" @click.stop>
    <div class="sync-center-header">
      <strong>Sync activity</strong>
      <span class="sync-center-queue">
        <span v-if="activeCount > 0" class="queue-pill"
          ><i class="bi bi-hourglass-split"></i> {{ activeCount }} active</span
        >
        <span v-if="waitingCount > 0" class="queue-pill"
          ><i class="bi bi-pause-circle"></i> {{ waitingCount }} waiting</span
        >
        <span
          v-if="activeCount === 0 && waitingCount === 0"
          class="queue-pill queue-pill-idle"
          >Idle</span
        >
      </span>
    </div>

    <div class="sync-center-section">
      <div class="sync-center-section-title">
        Failed actions
        <kbd class="failure-badge" v-if="syncStore.failuresCount > 0">{{
          syncStore.failuresCount
        }}</kbd>
      </div>
      <div v-if="recentFailures.length === 0" class="sync-center-empty">
        <i class="bi bi-check2-circle"></i> No failed actions
      </div>
      <ul v-else class="sync-center-list">
        <li
          v-for="failure in recentFailures"
          :key="failure.id"
          class="sync-center-failure"
        >
          <div class="failure-row">
            <kbd class="badge" :class="'kind-' + failure.kind">
              {{ failure.kind === "conflict" ? "Conflict" : "Error" }}
            </kbd>
            <span class="failure-target">{{ failureTarget(failure) }}</span>
            <span class="failure-date">{{
              formatDate(failure.dateCreated)
            }}</span>
          </div>
          <div v-if="failure.humanCause" class="failure-cause">
            {{ failure.humanCause }}
          </div>
          <details v-if="failure.errorMessage" class="failure-details">
            <summary>Technical detail</summary>
            <code>{{ failure.errorMessage }}</code>
          </details>
        </li>
      </ul>
      <NuxtLink
        to="/settings/sync?tab=failures"
        class="sync-center-link"
        @click="close()"
        >
        Review all failures in Settings → Sync
        <i class="bi bi-arrow-right-short"></i>
      </NuxtLink>
    </div>

    <div
      v-if="syncStore.recentOperations.length > 0"
      class="sync-center-section"
    >
      <div class="sync-center-section-title">Recent operations</div>
      <ul class="sync-center-list">
        <li
          v-for="(operation, index) in syncStore.recentOperations"
          :key="operation.date + '-' + index"
          class="sync-center-operation"
        >
          <i class="bi bi-check2"></i>
          <span class="operation-label">{{ operation.label }}</span>
          <span v-if="operation.fileCount > 1" class="operation-count"
            >{{ operation.fileCount }} files</span
          >
          <span class="operation-date">{{
            formatDate(operation.date)
          }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
export default {
  emits: ["close"],
  computed: {
    syncStore() {
      return SyncStore();
    },
    // The failure detail cards already match what the websocket delivers per
    // viewer (permission-filtered server-side), so the panel only reads store
    // state: no REST calls here (GET /sync/failures is admin-only).
    recentFailures() {
      return (this.syncStore.failures || []).slice(0, 5);
    },
    activeCount() {
      const entry = (this.syncStore.counts || []).find(
        (c) => c.type === "ACTIVE",
      );
      return entry ? entry.count : 0;
    },
    waitingCount() {
      const entry = (this.syncStore.counts || []).find(
        (c) => c.type === "WAITING",
      );
      return entry ? entry.count : 0;
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("keydown", this.onKeydown);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("keydown", this.onKeydown);
  },
  methods: {
    close() {
      this.$emit("close");
    },
    onDocumentClick(event) {
      const root = this.$el.closest(".sync-center-root");
      if (root && !root.contains(event.target)) {
        this.close();
      }
    },
    onKeydown(event) {
      if (event.key === "Escape") {
        this.close();
      }
    },
    failureTarget(failure) {
      const d = failure.data || {};
      if (failure.filePath) {
        return failure.filePath;
      }
      if (d.folderpath) {
        return d.folderpath;
      }
      return failure.functionName;
    },
    formatDate(date) {
      if (!date) return "";
      const d = new Date(date);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      return sameDay
        ? d.toLocaleTimeString()
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    },
  },
};
</script>

<style scoped>
.sync-center-panel {
  position: absolute;
  top: calc(100% + var(--space-sm));
  right: 0;
  width: 26rem;
  max-width: calc(100vw - 2 * var(--space-base));
  max-height: min(70vh, 34rem);
  overflow-y: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 0.5rem 1.5rem var(--color-overlay);
  z-index: 100;
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  font-size: var(--font-base);
  text-align: left;
}

.sync-center-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.sync-center-queue {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.queue-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-bg-hover);
  font-size: var(--font-sm);
}
.queue-pill-idle {
  opacity: 0.6;
}

.sync-center-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.sync-center-section-title {
  font-size: var(--font-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.failure-badge {
  background: var(--color-danger);
  color: var(--color-text-inverse);
  border-radius: var(--radius-full);
  padding: 0 0.5em;
  font-size: var(--font-xs);
}

.sync-center-empty {
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.sync-center-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.sync-center-failure {
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-danger);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.sync-center-failure .badge {
  display: inline-block;
  padding: 0 0.5em;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 600;
}
.kind-conflict {
  background: rgba(253, 126, 20, 0.2);
  color: var(--color-warning);
}
.kind-error {
  background: rgba(220, 53, 69, 0.2);
  color: var(--color-danger);
}
.failure-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.failure-target {
  font-weight: 500;
  word-break: break-all;
  min-width: 0;
}
.failure-date {
  margin-left: auto;
  opacity: 0.6;
  font-size: var(--font-xs);
  white-space: nowrap;
}
.failure-cause {
  font-size: var(--font-sm);
}
.failure-details summary {
  font-size: var(--font-xs);
  opacity: 0.6;
  cursor: pointer;
}
.failure-details code {
  display: block;
  font-size: var(--font-xs);
  background: var(--color-danger-bg);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  word-break: break-word;
  white-space: pre-wrap;
  margin-top: var(--space-xs);
}

.sync-center-link {
  font-size: var(--font-sm);
  display: inline-flex;
  align-items: center;
}

.sync-center-operation {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.sync-center-operation i {
  color: var(--color-success);
}
.operation-label {
  min-width: 0;
}
.operation-count {
  opacity: 0.7;
  font-size: var(--font-xs);
}
.operation-date {
  margin-left: auto;
  opacity: 0.6;
  font-size: var(--font-xs);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .sync-center-panel {
    position: fixed;
    top: 2rem;
    left: 0;
    right: 0;
    width: 100%;
    max-width: none;
    max-height: 75vh;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }
}
</style>
