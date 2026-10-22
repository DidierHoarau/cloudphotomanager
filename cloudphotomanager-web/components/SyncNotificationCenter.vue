<template>
  <Teleport to="body">
    <dialog open class="sync-center-dialog" @click.self="close()">
      <article class="dialog-standard sync-center-panel">
        <header>
          <a
            href="#close"
            class="close"
            aria-label="Close"
            @click.prevent="close()"
          ></a>
          Sync activity
        </header>

        <div class="dialog-standard-body sync-center-body">
          <div class="sync-summary">
            <span v-if="activeCount > 0" class="sync-summary-pill pill-active">
              <i class="bi bi-hourglass-split"></i> {{ activeCount }} active
            </span>
            <span
              v-if="waitingCount > 0"
              class="sync-summary-pill pill-waiting"
            >
              <i class="bi bi-pause-circle"></i> {{ waitingCount }} waiting
            </span>
            <span
              v-if="activeCount === 0 && waitingCount === 0"
              class="sync-summary-pill pill-idle"
            >
              <i class="bi bi-check2-circle"></i> Idle
            </span>
          </div>

          <section class="sync-section">
            <h2 class="sync-section-title">
              Failed actions
              <span v-if="syncStore.failuresCount > 0" class="count-badge">{{
                syncStore.failuresCount
              }}</span>
            </h2>
            <p v-if="recentFailures.length === 0" class="sync-empty">
              <i class="bi bi-check2-circle"></i> No failed actions
            </p>
            <ul v-else class="sync-failure-list">
              <li
                v-for="failure in recentFailures"
                :key="failure.id"
                class="sync-failure"
                :class="'sync-failure-' + failure.kind"
              >
                <div class="failure-head">
                  <span class="failure-kind" :class="'kind-' + failure.kind">
                    {{ failure.kind === "conflict" ? "Conflict" : "Error" }}
                  </span>
                  <span class="failure-target">{{
                    failureTarget(failure)
                  }}</span>
                  <time class="failure-date">{{
                    formatDate(failure.dateCreated)
                  }}</time>
                </div>
                <p v-if="failure.humanCause" class="failure-cause">
                  {{ failure.humanCause }}
                </p>
                <details v-if="failure.errorMessage" class="failure-details">
                  <summary>Technical details</summary>
                  <code>{{ failure.errorMessage }}</code>
                </details>
              </li>
            </ul>
          </section>

          <section
            v-if="syncStore.recentOperations.length > 0"
            class="sync-section"
          >
            <h2 class="sync-section-title">Recent operations</h2>
            <ul class="sync-operation-list">
              <li
                v-for="(operation, index) in syncStore.recentOperations"
                :key="operation.date + '-' + index"
                class="sync-operation"
              >
                <i class="bi bi-check2-circle"></i>
                <span class="operation-label">{{ operation.label }}</span>
                <span v-if="operation.fileCount > 1" class="operation-count"
                  >{{ operation.fileCount }} files</span
                >
                <time class="operation-date">{{
                  formatDate(operation.date)
                }}</time>
              </li>
            </ul>
          </section>
        </div>

        <footer class="dialog-standard-footer">
          <button class="secondary outline" @click="close()">Close</button>
          <NuxtLink
            to="/settings/sync?tab=failures"
            role="button"
            @click="close()"
            >Open Sync settings</NuxtLink
          >
        </footer>
      </article>
    </dialog>
  </Teleport>
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
    document.addEventListener("keydown", this.onKeydown);
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.onKeydown);
  },
  methods: {
    close() {
      this.$emit("close");
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
.sync-center-dialog .sync-center-panel {
  width: min(34em, 92vw);
}

.sync-center-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.sync-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.sync-summary-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-full);
  background: var(--color-bg-secondary);
  font-size: var(--font-base);
  font-weight: 600;
}
.pill-active {
  color: var(--color-primary-text);
  border-color: var(--color-primary-light);
  background: var(--color-primary-light);
}
.pill-waiting {
  color: var(--color-warning);
}
.pill-idle {
  color: var(--color-success);
}

.sync-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0;
}
.sync-section-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  padding: 0;
  font-size: var(--font-body);
  font-weight: 700;
}
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.7em;
  height: 1.7em;
  padding: 0 0.4em;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: var(--color-text-inverse);
  font-size: var(--font-xs);
  font-weight: 600;
}

.sync-empty {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-text-muted);
}
.sync-empty i {
  color: var(--color-success);
  font-size: 1.1em;
}

.sync-failure-list,
.sync-operation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.sync-failure {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--color-border-light);
  border-left: 3px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}
.sync-failure-conflict {
  border-left-color: var(--color-warning);
}
.failure-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  min-width: 0;
}
.failure-kind {
  flex-shrink: 0;
  padding: 0 0.5em;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.kind-conflict {
  background: rgba(253, 126, 20, 0.16);
  color: var(--color-warning);
}
.kind-error {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.failure-target {
  min-width: 0;
  font-size: var(--font-base);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.failure-date {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.failure-cause {
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-text-secondary);
}
.failure-details summary {
  font-size: var(--font-sm);
  color: var(--color-text-muted);
  cursor: pointer;
}
.failure-details code {
  display: block;
  margin-top: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  font-size: var(--font-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.sync-operation {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  font-size: var(--font-base);
}
.sync-operation i {
  flex-shrink: 0;
  color: var(--color-success);
}
.operation-label {
  min-width: 0;
}
.operation-count {
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.operation-date {
  margin-left: auto;
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

@media (max-width: 480px) {
  .failure-head {
    flex-wrap: wrap;
  }
  .failure-date {
    flex-basis: 100%;
    margin-left: 0;
    text-align: right;
  }
  .dialog-standard-footer > button,
  .dialog-standard-footer > [role="button"] {
    font-size: var(--font-base);
    padding: var(--space-sm) var(--space-md);
  }
}
</style>
