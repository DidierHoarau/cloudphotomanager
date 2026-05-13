<template>
  <div class="failures-panel">
    <div v-if="showConfirm" class="confirm-overlay">
      <DialogConfirm
        :title="confirmTitle"
        :message="confirmMessage"
        @onConfirm="onConfirmConfirm"
        @onCancel="onConfirmCancel"
      />
    </div>

    <div class="failures-toolbar">
      <div class="failures-toolbar-info">
        <strong>{{ failures.length }}</strong>
        failed {{ failures.length === 1 ? "action" : "actions" }}
        <small class="retention-hint"> (kept for 24 h, max 500) </small>
      </div>
      <div class="failures-toolbar-actions">
        <button
          class="secondary outline"
          :disabled="failures.length === 0 || busy"
          @click="clickedRetryAll"
          title="Retry all failed actions"
        >
          <i class="bi bi-arrow-repeat"></i> Retry all
        </button>
        <button
          class="secondary outline"
          :disabled="failures.length === 0 || busy"
          @click="clickedCancelAll"
          title="Remove all failures"
        >
          <i class="bi bi-x-lg"></i> Cancel all
        </button>
      </div>
    </div>

    <div v-if="failures.length === 0" class="empty-state">
      <i class="bi bi-check2-circle"></i>
      <p>No failed actions</p>
    </div>

    <ul v-else class="failures-list">
      <li
        v-for="failure in failures"
        :key="failure.id"
        class="failure-card"
        :class="{
          'failure-card-conflict': failure.kind === 'conflict',
          'failure-card-error': failure.kind === 'error',
        }"
      >
        <div class="failure-header">
          <kbd class="badge" :class="'kind-' + failure.kind">
            {{ failure.kind === "conflict" ? "Name conflict" : "Error" }}
          </kbd>
          <code class="failure-function">{{ failure.functionName }}</code>
          <span class="failure-date">{{
            formatDate(failure.dateCreated)
          }}</span>
        </div>

        <!-- Conflict layout -->
        <div
          v-if="failure.kind === 'conflict' && failure.conflict"
          class="conflict-body"
        >
          <div class="conflict-pair">
            <div class="conflict-side">
              <div class="conflict-side-label">Source (being moved)</div>
              <div class="conflict-thumb">
                <LazyMediaThumbnail
                  v-if="sourceFile(failure)"
                  :file="sourceFile(failure)"
                />
                <div v-else class="conflict-thumb-placeholder">
                  <i class="bi bi-question-circle"></i>
                </div>
              </div>
              <div class="conflict-meta">
                <div class="conflict-meta-name">
                  {{ failure.conflict.source.filename }}
                </div>
                <div class="conflict-meta-path">
                  {{ failure.conflict.source.folderpath || "-" }}
                </div>
                <div class="conflict-meta-stats">
                  <span>{{
                    formatDate(failure.conflict.source.dateMedia)
                  }}</span>
                  <span>{{ formatSize(failure.conflict.source.size) }}</span>
                </div>
              </div>
            </div>

            <div class="conflict-arrow"><i class="bi bi-arrow-right"></i></div>

            <div class="conflict-side">
              <div class="conflict-side-label">Target (existing)</div>
              <div class="conflict-thumb">
                <LazyMediaThumbnail
                  v-if="targetFile(failure)"
                  :file="targetFile(failure)"
                />
                <div v-else class="conflict-thumb-placeholder">
                  <i class="bi bi-question-circle"></i>
                </div>
              </div>
              <div class="conflict-meta">
                <div class="conflict-meta-name">
                  {{ failure.conflict.target.filename }}
                </div>
                <div class="conflict-meta-path">
                  {{ failure.conflict.target.folderpath || "-" }}
                </div>
                <div class="conflict-meta-stats">
                  <span>{{
                    formatDate(failure.conflict.target.dateMedia)
                  }}</span>
                  <span>{{ formatSize(failure.conflict.target.size) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="failure-actions">
            <button
              class="action-btn action-replace"
              :disabled="busy || !failure.conflict.targetFileId"
              @click="clickedReplace(failure)"
              :title="
                failure.conflict.targetFileId
                  ? 'Delete the existing destination file, then move the source in its place'
                  : 'Target file id not available'
              "
            >
              <i class="bi bi-arrow-repeat"></i> Replace Destination
            </button>
            <button
              class="action-btn action-delete-source"
              :disabled="busy"
              @click="clickedDeleteSource(failure)"
              title="Delete the origin file being moved"
            >
              <i class="bi bi-trash"></i> Remove Origin file
            </button>
            <button
              class="action-btn"
              :disabled="busy"
              @click="clickedRetry(failure)"
              title="Re-queue the move"
            >
              <i class="bi bi-arrow-clockwise"></i> Retry
            </button>
            <button
              class="action-btn secondary"
              :disabled="busy"
              @click="clickedCancel(failure)"
              title="Dismiss this failure"
            >
              <i class="bi bi-x-lg"></i> Cancel
            </button>
          </div>
        </div>

        <!-- Error layout -->
        <div v-else class="error-body">
          <div class="error-label">{{ describeError(failure) }}</div>
          <div v-if="failure.errorMessage" class="error-message">
            {{ failure.errorMessage }}
          </div>
          <div class="failure-actions">
            <button
              class="action-btn"
              :disabled="busy"
              @click="clickedRetry(failure)"
            >
              <i class="bi bi-arrow-clockwise"></i> Retry
            </button>
            <button
              class="action-btn secondary"
              :disabled="busy"
              @click="clickedCancel(failure)"
            >
              <i class="bi bi-x-lg"></i> Cancel
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  props: {
    failures: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      busy: false,
      showConfirm: false,
      confirmTitle: "Confirm",
      confirmMessage: "",
      pendingAction: null,
    };
  },
  methods: {
    sourceFile(failure) {
      const c = failure.conflict;
      if (!c || !c.sourceFileId) return null;
      return {
        id: c.sourceFileId,
        accountId: failure.accountId,
        filename: c.source.filename,
      };
    },
    targetFile(failure) {
      const c = failure.conflict;
      if (!c || !c.targetFileId) return null;
      return {
        id: c.targetFileId,
        accountId: failure.accountId,
        filename: c.target.filename,
      };
    },
    formatDate(date) {
      if (!date) return "Unknown";
      return new Date(date).toLocaleString();
    },
    formatSize(bytes) {
      if (bytes === null || bytes === undefined) return "Unknown";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    },
    describeError(failure) {
      const d = failure.data || {};
      const fn = failure.functionName;
      if (fn === "fileDelete") return `Delete: ${d.fileId || ""}`;
      if (fn === "fileRename") return `Rename: ${d.filename || d.fileId || ""}`;
      if (fn === "folderMove")
        return `Move: ${d.fileId || ""}${d.folderpath ? " \u2192 " + d.folderpath : ""}`;
      if (fn === "fileCacheRebuild") return `Rebuild cache: ${d.fileId || ""}`;
      return fn;
    },
    askConfirm(title, message, action) {
      this.confirmTitle = title;
      this.confirmMessage = message;
      this.pendingAction = action;
      this.showConfirm = true;
    },
    onConfirmCancel() {
      this.showConfirm = false;
      this.pendingAction = null;
    },
    async onConfirmConfirm() {
      this.showConfirm = false;
      const action = this.pendingAction;
      this.pendingAction = null;
      if (!action) return;
      this.busy = true;
      try {
        await action();
      } finally {
        this.busy = false;
      }
    },
    clickedRetry(failure) {
      this.askConfirm(
        "Retry action",
        `Re-queue this ${failure.functionName} operation?`,
        () => SyncStore().retryFailure(failure.id),
      );
    },
    clickedCancel(failure) {
      this.askConfirm(
        "Cancel action",
        "Dismiss this failure? The original operation will not be retried.",
        () => SyncStore().cancelFailure(failure.id),
      );
    },
    clickedReplace(failure) {
      const c = failure.conflict;
      this.askConfirm(
        "Replace Destination",
        `Delete the existing destination file and move the source in its place?\nDestination: ${c.target.filename} in ${c.targetFolderpath}`,
        () => SyncStore().resolveFailure(failure.id, "replace"),
      );
    },
    clickedDeleteSource(failure) {
      const c = failure.conflict;
      this.askConfirm(
        "Remove Origin file",
        `Delete the origin file being moved? (Can't be undone!)\nFile: ${c.source.filename}`,
        () => SyncStore().resolveFailure(failure.id, "deleteSource"),
      );
    },
    clickedRetryAll() {
      this.askConfirm(
        "Retry all",
        "Re-queue all failed actions? Conflicts that still exist will be recorded again.",
        () => SyncStore().retryAllFailures(),
      );
    },
    clickedCancelAll() {
      this.askConfirm(
        "Cancel all",
        "Dismiss all failures? None of the original operations will be retried.",
        () => SyncStore().cancelAllFailures(),
      );
    },
  },
};
</script>

<style scoped>
.failures-panel {
  display: flex;
  flex-direction: column;
  gap: 1em;
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.failures-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75em;
  align-items: center;
  justify-content: space-between;
  padding: 0.5em 0;
}
.failures-toolbar-info {
  font-size: 0.95em;
}
.retention-hint {
  opacity: 0.6;
  margin-left: 0.4em;
}
.failures-toolbar-actions {
  display: flex;
  gap: 0.5em;
  flex-wrap: wrap;
}
.failures-toolbar-actions button {
  padding: 0.35em 0.9em;
  font-size: 0.9em;
}

.empty-state {
  text-align: center;
  padding: 3em 1em;
  opacity: 0.6;
}
.empty-state i {
  font-size: 3em;
  margin-bottom: 0.4em;
  color: #198754;
}

.failures-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75em;
}

.failure-card {
  border-radius: 0.4em;
  padding: 0.85em 1em;
  border: 1px solid rgba(128, 128, 128, 0.25);
  background: rgba(128, 128, 128, 0.04);
}
.failure-card-conflict {
  border-left: 4px solid #fd7e14;
}
.failure-card-error {
  border-left: 4px solid #dc3545;
}

.failure-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6em;
  align-items: center;
  margin-bottom: 0.5em;
  font-size: 0.85em;
}
.failure-header .badge {
  display: inline-block;
  padding: 0.2em 0.6em;
  border-radius: 0.25em;
  font-size: 0.75em;
  font-weight: 600;
}
.kind-conflict {
  background: rgba(253, 126, 20, 0.2);
  color: #fd7e14;
}
.kind-error {
  background: rgba(220, 53, 69, 0.2);
  color: #dc3545;
}
.failure-function {
  background: rgba(0, 0, 0, 0.08);
  padding: 0.1em 0.4em;
  border-radius: 0.2em;
  font-size: 0.85em;
}
.failure-date {
  margin-left: auto;
  opacity: 0.65;
  font-size: 0.8em;
}

.conflict-pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.75em;
  align-items: stretch;
}
.conflict-side {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  padding: 0.6em;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 0.35em;
  min-width: 0;
}
.conflict-side-label {
  font-size: 0.8em;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.conflict-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: rgba(128, 128, 128, 0.15);
  border-radius: 0.25em;
  overflow: hidden;
}
.conflict-thumb-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  font-size: 2em;
}
.conflict-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  min-width: 0;
}
.conflict-meta-name {
  font-weight: 600;
  word-break: break-all;
}
.conflict-meta-path {
  font-size: 0.85em;
  opacity: 0.75;
  word-break: break-all;
}
.conflict-meta-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75em;
  font-size: 0.8em;
  opacity: 0.75;
}
.conflict-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  font-size: 1.3em;
}

.error-body {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}
.error-label {
  font-weight: 500;
}
.error-message {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  background: rgba(220, 53, 69, 0.08);
  padding: 0.4em 0.6em;
  border-radius: 0.3em;
  word-break: break-word;
  white-space: pre-wrap;
}

.failure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 0.75em;
}
.action-btn {
  padding: 0.35em 0.9em;
  font-size: 0.9em;
  border-radius: 0.3em;
  cursor: pointer;
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-replace {
  background: #fd7e14;
  color: #fff;
  border-color: #fd7e14;
}
.action-delete-source {
  background: #dc3545;
  color: #fff;
  border-color: #dc3545;
}

@media (max-width: 640px) {
  .conflict-pair {
    grid-template-columns: 1fr;
  }
  .conflict-arrow {
    transform: rotate(90deg);
  }
  .failure-date {
    margin-left: 0;
    flex-basis: 100%;
  }
}
</style>
