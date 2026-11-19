<template>
  <SearchLayout @onAccountSelected="onAccountSelected">
    <div class="duplicate-gallery-content">
      <template v-if="loading || hasLoaded">
        <div class="duplicate-toolbar">
          <input
            v-model="analysisFilter"
            type="search"
            placeholder="Filter duplicates by filename or path…"
            aria-label="Filter duplicates by filename or path"
            class="duplicate-filter-input"
            @input="onSearchFilterChanged"
          />
          <div v-if="isAdmin" class="duplicate-toolbar-actions">
            <button
              type="button"
              class="secondary outline"
              :disabled="groups.length === 0"
              @click="selectAllLoaded"
            >
              Select all loaded
            </button>
            <button
              type="button"
              class="secondary outline"
              :disabled="selectedHashes.length === 0"
              @click="clearSelection"
            >
              Clear selection
            </button>
            <kbd v-if="selectedHashes.length > 0"
              >Selected: {{ selectedHashes.length }}</kbd
            >
            <button
              type="button"
              :disabled="!canMutate || selectedHashes.length === 0"
              :aria-label="bulkTrashAriaLabel"
              :title="mutationTitle"
              @click="requestBulkTrash"
            >
              <i class="bi bi-trash"></i> Move selected to Trash
            </button>
            <button
              type="button"
              class="secondary outline"
              :disabled="!canMutate || selectedHashes.length === 0"
              :aria-label="bulkIgnoreAriaLabel"
              :title="mutationTitle"
              @click="requestIgnoreSelected"
            >
              <i class="bi bi-hand-thumbs-up"></i> Ignore selected groups
            </button>
          </div>
        </div>

        <p class="duplicate-status" role="status" aria-live="polite">
          Showing {{ groups.length }} of {{ total }} duplicate groups
          <template v-if="activeFilter">
            — {{ filteredGroups.length }} match the filter
          </template>
        </p>
        <p v-if="!isOnline" class="duplicate-offline-note" role="status">
          <i class="bi bi-wifi-off"></i> You are offline — review is read-only
          until the connection returns.
        </p>

        <div v-if="lastBulk" class="duplicate-undo-banner" role="status">
          <span>
            Moved {{ lastBulk.fileIds.length }} copies to Trash — restorable for
            30 days.
          </span>
          <button
            type="button"
            class="secondary outline"
            :disabled="!canMutate || undoBusy"
            :aria-label="undoAriaLabel"
            @click="undoBulk"
          >
            Undo
          </button>
          <NuxtLink to="/settings/trash">Open Trash</NuxtLink>
        </div>

        <details v-if="isAdmin" class="duplicate-ignored-panel">
          <summary>Ignored groups ({{ ignoredGroups.length }})</summary>
          <Loading v-if="ignoredLoading" />
          <p v-else-if="ignoredGroups.length === 0" class="duplicate-ignored-empty">
            No ignored groups.
          </p>
          <ul v-else class="duplicate-ignored-list">
            <li v-for="ignore in ignoredGroups" :key="ignore.hash">
              <span class="duplicate-ignored-name">{{
                ignore.info.filename || ignore.hash
              }}</span>
              <span class="duplicate-ignored-meta">
                {{ ignore.info.fileCount || 2 }} copies · ignored
                {{ formatDate(ignore.dateIgnored) }}
              </span>
              <button
                type="button"
                class="secondary outline"
                :disabled="!canMutate || ignoredBusy"
                :aria-label="restoreIgnoreAriaLabel(ignore)"
                @click="unignoreGroup(ignore.hash)"
              >
                Restore
              </button>
            </li>
          </ul>
        </details>

        <div class="analysis-item-list">
          <Loading v-if="loading" />
          <template v-else>
            <div v-if="filteredGroups.length === 0" class="duplicate-empty-state">
              <i class="bi bi-files"></i>
              <p v-if="total === 0">No duplicate groups found.</p>
              <p v-else>No loaded groups match the filter.</p>
            </div>
            <div v-else class="duplicate-card-grid">
              <article
                v-for="(group, index) in filteredGroups"
                :key="group.hash"
                class="duplicate-group-card"
                :class="{ 'duplicate-group-card--selected': isSelected(group.hash) }"
              >
                <div v-if="isAdmin" class="duplicate-group-select">
                  <input
                    :id="`dup-select-${group.hash}`"
                    type="checkbox"
                    :checked="isSelected(group.hash)"
                    :aria-label="selectionAriaLabel(group, index)"
                    @change="toggleGroup(group.hash)"
                  />
                  <label :for="`dup-select-${group.hash}`">Select group</label>
                </div>
                <div class="duplicate-card-thumb">
                  <LazyMediaThumbnail
                    :file="group.files[0]"
                    :duplicateCount="group.files.length"
                    @click="openCompare(group)"
                  />
                </div>
                <p class="duplicate-keep-line">
                  Keeping:
                  <strong>{{ keepFilename(group) }}</strong> — {{ keepReason(group) }}
                </p>
                <p class="duplicate-group-meta">
                  {{ group.files.length }} copies
                </p>
                <div class="duplicate-card-paths">
                  <div
                    v-for="file in group.files"
                    :key="file.id"
                    class="duplicate-card-path"
                  >
                    {{ pathFor(file) }}
                  </div>
                </div>
                <button
                  type="button"
                  class="secondary outline duplicate-review-btn"
                  :aria-label="reviewAriaLabel(group)"
                  @click="openCompare(group)"
                >
                  <i class="bi bi-columns-gap"></i> Review group
                </button>
              </article>
            </div>
            <div ref="sentinel" class="sentinel"></div>
            <Loading v-if="loadingMore" />
            <button
              v-if="hasMore"
              type="button"
              class="secondary outline duplicate-load-more"
              :disabled="loadingMore"
              @click="loadMore"
            >
              Load more groups
            </button>
            <p v-else-if="groups.length > 0" class="duplicate-end-note">
              All duplicate groups loaded.
            </p>
          </template>
        </div>
      </template>
      <template v-else>
        <div class="duplicate-empty-state">
          <i class="bi bi-files"></i>
          <p>Select an account to search for duplicate photos</p>
        </div>
      </template>

      <DialogDuplicateCompare
        v-if="compareGroup"
        :group="compareGroup"
        :folderPaths="folderMap"
        :suggestedKeepId="compareSuggestedKeepId"
        :initialKeepId="compareInitialKeepId"
        :isAdmin="isAdmin"
        :isOnline="isOnline"
        @onKeepSelected="onKeepSelected"
        @onRequestTrash="onRequestTrash"
        @onRequestIgnore="onRequestIgnore"
        @onClose="closeCompare"
      />

      <DialogConfirm
        v-if="showConfirmDialog"
        :title="confirmDialogTitle"
        :message="confirmDialogMessage"
        @onConfirm="onConfirmDialog"
        @onCancel="cancelConfirmDialog"
      />
    </div>
  </SearchLayout>
</template>

<script>
import axios from "axios";
import { debounce } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { DuplicateCountService } from "~~/services/DuplicateCountService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import {
  buildDuplicateTrashSummary,
  duplicateRemovalIds,
  resolveDuplicateKeep,
} from "~~/utils/DuplicateReview";

const PAGE_SIZE = 60;

export default {
  data() {
    return {
      groups: [],
      total: 0,
      page: 0,
      pageSize: PAGE_SIZE,
      hasLoaded: false,
      loading: false,
      loadingMore: false,
      requestEtag: "",
      currentAccountId: "",
      analysisFilter: "",
      activeFilter: "",
      selectedHashes: [],
      keepByHash: {},
      ignoredGroups: [],
      ignoredLoading: false,
      ignoredBusy: false,
      undoBusy: false,
      lastBulk: null,
      isOnline: true,
      serverUrl: "",
      compareGroup: null,
      compareSuggestedKeepId: null,
      compareInitialKeepId: null,
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      pendingTrash: null,
      confirmAction: null,
      observer: null,
      _onOperationComplete: null,
    };
  },
  async created() {
    const config = await Config.get();
    this.serverUrl = config.SERVER_URL;
    if (typeof navigator !== "undefined") {
      this.isOnline = navigator.onLine;
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onNetworkOnline);
      window.addEventListener("offline", this.onNetworkOffline);
    }
    this._onOperationComplete = (message) => {
      const ids = message?.fileIds || [];
      if (ids.length === 0) return;
      const operationName = message?.operationName || "";
      if (operationName === "fileTrash") {
        this.removeFilesFromGroups(ids);
      } else if (
        (operationName === "fileRestore" ||
          operationName === "fileDelete") &&
        this.hasLoaded
      ) {
        this.refreshLoaded();
      }
    };
    EventBus.on(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
    await AccountsStore().fetch();
    await FoldersStore().fetch();
  },
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          this.loadMore();
        }
      },
      { threshold: 0.1 },
    );
    if (this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
  },
  updated() {
    if (this.observer && this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
  },
  beforeUnmount() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onNetworkOnline);
      window.removeEventListener("offline", this.onNetworkOffline);
    }
    EventBus.off(EventTypes.OPERATION_COMPLETE, this._onOperationComplete);
  },
  computed: {
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
    canMutate() {
      return this.isAdmin && this.isOnline;
    },
    mutationTitle() {
      if (!this.isAdmin) return "Admin only";
      if (!this.isOnline) return "Unavailable while offline";
      return "";
    },
    bulkTrashAriaLabel() {
      const base = `Move ${this.selectedHashes.length} selected duplicate groups to Trash`;
      return this.isOnline ? base : `${base} (unavailable offline)`;
    },
    bulkIgnoreAriaLabel() {
      const base = `Ignore ${this.selectedHashes.length} selected duplicate groups`;
      return this.isOnline ? base : `${base} (unavailable offline)`;
    },
    undoAriaLabel() {
      return this.isOnline
        ? "Undo the last move to Trash"
        : "Undo the last move to Trash (unavailable offline)";
    },
    folderMap() {
      const map = new Map();
      for (const folder of FoldersStore().folders) {
        map.set(folder.id, folder.folderpath);
      }
      return map;
    },
    filteredGroups() {
      if (!this.activeFilter) {
        return this.groups;
      }
      const query = this.activeFilter.toLowerCase();
      return this.groups.filter((group) =>
        (group.files || []).some(
          (file) =>
            String(file.filename || "")
              .toLowerCase()
              .includes(query) ||
            String(this.folderMap.get(file.folderId) || "")
              .toLowerCase()
              .includes(query),
        ),
      );
    },
    hasMore() {
      return this.groups.length < this.total;
    },
  },
  watch: {
    activeFilter() {
      this.$nextTick(this.observerObserve);
    },
  },
  methods: {
    onNetworkOnline() {
      this.isOnline = true;
    },
    onNetworkOffline() {
      this.isOnline = false;
    },
    observerObserve() {
      if (this.observer && this.$refs.sentinel) {
        this.observer.observe(this.$refs.sentinel);
      }
    },
    async onAccountSelected(account) {
      if (!account || this.currentAccountId === account.id) {
        return;
      }
      await this.loadAccountDuplicates(account.id);
    },
    async loadAccountDuplicates(accountId) {
      this.currentAccountId = accountId;
      const requestEtag = `${accountId}-${Date.now()}`;
      this.requestEtag = requestEtag;
      this.loading = true;
      this.groups = [];
      this.total = 0;
      this.page = 0;
      this.hasLoaded = false;
      this.selectedHashes = [];
      this.keepByHash = {};
      this.lastBulk = null;
      this.compareGroup = null;
      this.activeFilter = "";
      try {
        await this.fetchPage(0, requestEtag);
        if (this.requestEtag === requestEtag) {
          this.hasLoaded = true;
        }
      } catch (err) {
        handleError(err);
      } finally {
        if (this.requestEtag === requestEtag) {
          this.loading = false;
        }
      }
      if (this.isAdmin) {
        await this.fetchIgnored(requestEtag);
      }
    },
    async fetchPage(page, requestEtag = this.requestEtag) {
      const res = await axios.get(
        `${this.serverUrl}/accounts/${this.currentAccountId}/analysis/duplicates?page=${page}&pageSize=${this.pageSize}`,
        await AuthService.getAuthHeader(),
      );
      if (this.requestEtag !== requestEtag) {
        return false;
      }
      const duplicates = res.data.duplicates || [];
      this.groups = page === 0 ? duplicates : [...this.groups, ...duplicates];
      this.total = Number(res.data.total || 0);
      this.page = page;
      return true;
    },
    async loadMore() {
      if (!this.hasMore || this.loadingMore || this.loading) return;
      this.loadingMore = true;
      try {
        await this.fetchPage(this.page + 1);
      } catch (err) {
        handleError(err);
      } finally {
        this.loadingMore = false;
      }
    },
    // Re-fetches the pages already loaded (after a Trash restore or an
    // external operation) without a full page reload.
    async refreshLoaded() {
      if (!this.currentAccountId || this.loading) return;
      const requestEtag = this.requestEtag;
      const lastPage = this.page;
      const fresh = [];
      let total = this.total;
      try {
        for (let page = 0; page <= lastPage; page++) {
          const res = await axios.get(
            `${this.serverUrl}/accounts/${this.currentAccountId}/analysis/duplicates?page=${page}&pageSize=${this.pageSize}`,
            await AuthService.getAuthHeader(),
          );
          if (this.requestEtag !== requestEtag) return;
          const duplicates = res.data.duplicates || [];
          fresh.push(...duplicates);
          total = Number(res.data.total || 0);
          if (duplicates.length === 0 || fresh.length >= total) break;
        }
      } catch (err) {
        handleError(err);
        return;
      }
      if (this.requestEtag !== requestEtag) return;
      this.groups = fresh;
      this.total = total;
      this.selectedHashes = this.selectedHashes.filter((hash) =>
        fresh.some((group) => group.hash === hash),
      );
      if (
        this.compareGroup &&
        !fresh.some((group) => group.hash === this.compareGroup.hash)
      ) {
        this.compareGroup = null;
      }
    },
    async fetchIgnored(requestEtag = this.requestEtag) {
      this.ignoredLoading = true;
      try {
        const res = await axios.get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/analysis/duplicates/ignored`,
          await AuthService.getAuthHeader(),
        );
        if (this.requestEtag === requestEtag) {
          this.ignoredGroups = res.data.ignores || [];
        }
      } catch (err) {
        if (this.requestEtag === requestEtag) {
          this.ignoredGroups = [];
        }
      } finally {
        this.ignoredLoading = false;
      }
    },
    folderPathFor(folderId) {
      return this.folderMap.get(folderId) ?? "";
    },
    pathFor(file) {
      const folderPath = this.folderPathFor(file.folderId);
      return `${folderPath === "/" ? "" : folderPath}/${file.filename}`;
    },
    formatDate(value) {
      if (!value) return "unknown date";
      return new Date(value).toLocaleDateString();
    },
    keepResolution(group) {
      return resolveDuplicateKeep(group, this.keepByHash, this.folderMap);
    },
    keepFilename(group) {
      const keepId = this.keepResolution(group).keepId;
      const keep = (group.files || []).find((file) => file.id === keepId);
      return keep ? keep.filename : "";
    },
    keepReason(group) {
      return this.keepResolution(group).reason;
    },
    isSelected(hash) {
      return this.selectedHashes.includes(hash);
    },
    toggleGroup(hash) {
      if (this.isSelected(hash)) {
        this.selectedHashes = this.selectedHashes.filter(
          (value) => value !== hash,
        );
      } else {
        this.selectedHashes = [...this.selectedHashes, hash];
      }
    },
    selectAllLoaded() {
      this.selectedHashes = this.groups.map((group) => group.hash);
    },
    clearSelection() {
      this.selectedHashes = [];
    },
    selectionAriaLabel(group, index) {
      const filename = group.files?.[0]?.filename || "unknown file";
      return `Select duplicate group ${index + 1}: ${group.files.length} copies of ${filename}`;
    },
    reviewAriaLabel(group) {
      const filename = group.files?.[0]?.filename || "unknown file";
      return `Review duplicate group with ${group.files.length} copies of ${filename}`;
    },
    restoreIgnoreAriaLabel(ignore) {
      const filename = ignore.info?.filename || ignore.hash;
      return `Restore ignored duplicate group ${filename} to the list`;
    },
    openCompare(group) {
      const resolution = this.keepResolution(group);
      if (!this.keepByHash[group.hash] && resolution.keepId) {
        this.keepByHash = {
          ...this.keepByHash,
          [group.hash]: resolution.keepId,
        };
      }
      this.compareSuggestedKeepId = resolution.suggestedKeepId;
      this.compareInitialKeepId = this.keepByHash[group.hash] || resolution.keepId;
      this.compareGroup = group;
    },
    closeCompare() {
      this.compareGroup = null;
    },
    onKeepSelected(hash, fileId) {
      if (!hash || !fileId) return;
      this.keepByHash = { ...this.keepByHash, [hash]: fileId };
    },
    selectedGroups() {
      return this.groups.filter((group) =>
        this.selectedHashes.includes(group.hash),
      );
    },
    onRequestTrash(hash, keepFileId) {
      if (!this.canMutate) return;
      if (keepFileId) {
        this.keepByHash = { ...this.keepByHash, [hash]: keepFileId };
      }
      this.closeCompare();
      const group = this.groups.find((value) => value.hash === hash);
      if (group) {
        this.requestTrash([group]);
      }
    },
    onRequestIgnore(hash) {
      if (!this.canMutate) return;
      this.closeCompare();
      this.ignoreGroups([hash]);
    },
    requestBulkTrash() {
      if (!this.canMutate) return;
      this.requestTrash(this.selectedGroups());
    },
    requestTrash(groups) {
      if (!groups || groups.length === 0) return;
      const fileIds = duplicateRemovalIds(
        groups,
        this.keepByHash,
        this.folderMap,
      );
      if (fileIds.length === 0) {
        return;
      }
      const summary = buildDuplicateTrashSummary(
        groups,
        this.keepByHash,
        this.folderMap,
      );
      const removedByHash = {};
      for (const group of groups) {
        const keepId = resolveDuplicateKeep(
          group,
          this.keepByHash,
          this.folderMap,
        ).keepId;
        const removed = (group.files || []).filter(
          (file) => file.id !== keepId,
        );
        if (removed.length > 0) {
          removedByHash[group.hash] = removed.slice();
        }
      }
      this.pendingTrash = { fileIds, removedByHash };
      this.confirmDialogTitle = "Move to Trash";
      const pathLines = summary.lines.join("\n");
      const more = summary.truncated
        ? `\n…and ${summary.remaining} more`
        : "";
      this.confirmDialogMessage =
        `Move ${summary.fileCount} copies from ${summary.groupCount} duplicate ` +
        `groups to Trash? (Restorable for 30 days)\n\n${pathLines}${more}`;
      this.confirmAction = "trash";
      this.showConfirmDialog = true;
    },
    requestIgnoreSelected() {
      if (!this.canMutate) return;
      this.ignoreGroups([...this.selectedHashes]);
    },
    onConfirmDialog() {
      this.showConfirmDialog = false;
      const action = this.confirmAction;
      this.confirmAction = null;
      if (action === "trash") {
        this.confirmTrash();
      }
    },
    cancelConfirmDialog() {
      this.showConfirmDialog = false;
      this.confirmAction = null;
      this.pendingTrash = null;
    },
    async confirmTrash() {
      const pending = this.pendingTrash;
      this.pendingTrash = null;
      if (!pending || !this.canMutate) return;
      const accountId = this.currentAccountId;
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${accountId}/files/batch/operations/fileDelete`,
          { fileIdList: pending.fileIds },
          await AuthService.getAuthHeader(),
        );
        this.removeFilesFromGroups(pending.fileIds);
        this.lastBulk = {
          accountId,
          fileIds: pending.fileIds,
          removedByHash: pending.removedByHash,
        };
        DuplicateCountService.invalidate(accountId, pending.fileIds);
        EventBus.emit(EventTypes.FOLDER_UPDATED, {});
        EventBus.emit(EventTypes.FILE_UPDATED, {});
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: `Moved ${pending.fileIds.length} copies to Trash — restorable for 30 days`,
        });
      } catch (err) {
        handleError(err);
      }
    },
    removeFilesFromGroups(fileIds) {
      if (!fileIds || fileIds.length === 0) return;
      const removedIds = new Set(fileIds);
      let droppedGroups = 0;
      const nextGroups = [];
      for (const group of this.groups) {
        const remaining = (group.files || []).filter(
          (file) => !removedIds.has(file.id),
        );
        if (remaining.length === group.files.length) {
          nextGroups.push(group);
          continue;
        }
        if (remaining.length < 2) {
          droppedGroups++;
          this.selectedHashes = this.selectedHashes.filter(
            (hash) => hash !== group.hash,
          );
          if (this.compareGroup && this.compareGroup.hash === group.hash) {
            this.compareGroup = null;
          }
        } else {
          group.files = remaining;
          nextGroups.push(group);
        }
      }
      this.groups = nextGroups;
      this.total = Math.max(0, this.total - droppedGroups);
    },
    async undoBulk() {
      if (!this.lastBulk || !this.canMutate || this.undoBusy) return;
      const bulk = this.lastBulk;
      this.undoBusy = true;
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${bulk.accountId}/trash/restore`,
          { fileIdList: bulk.fileIds },
          await AuthService.getAuthHeader(),
        );
        for (const [hash, files] of Object.entries(bulk.removedByHash)) {
          let group = this.groups.find((value) => value.hash === hash);
          if (!group) {
            group = {
              accountId: bulk.accountId,
              hash,
              files: [],
              folders: [],
            };
            this.groups.push(group);
            this.total++;
          }
          for (const file of files) {
            if (!group.files.some((value) => value.id === file.id)) {
              group.files.push(file);
            }
          }
          group.files.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        }
        this.groups.sort((a, b) => a.hash.localeCompare(b.hash));
        this.lastBulk = null;
        DuplicateCountService.invalidate(bulk.accountId, bulk.fileIds);
        EventBus.emit(EventTypes.FOLDER_UPDATED, {});
        EventBus.emit(EventTypes.FILE_UPDATED, {});
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: `Restored ${bulk.fileIds.length} copies`,
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.undoBusy = false;
      }
    },
    async ignoreGroups(hashes) {
      if (!this.canMutate) return;
      const unique = [...new Set(hashes.filter(Boolean))];
      if (unique.length === 0) return;
      const accountId = this.currentAccountId;
      try {
        const res = await axios.post(
          `${this.serverUrl}/accounts/${accountId}/analysis/duplicates/ignore`,
          { hashes: unique },
          await AuthService.getAuthHeader(),
        );
        const ignored = Number(res.data?.ignored || 0);
        const ignoredSet = new Set(unique);
        let dropped = 0;
        this.groups = this.groups.filter((group) => {
          if (!ignoredSet.has(group.hash)) return true;
          dropped++;
          return false;
        });
        this.total = Math.max(0, this.total - dropped);
        this.selectedHashes = this.selectedHashes.filter(
          (hash) => !ignoredSet.has(hash),
        );
        if (this.compareGroup && ignoredSet.has(this.compareGroup.hash)) {
          this.compareGroup = null;
        }
        DuplicateCountService.invalidate(accountId);
        await this.fetchIgnored();
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text:
            ignored > 0
              ? `Ignored ${ignored} ${
                  ignored === 1 ? "group" : "groups"
                } — restore from "Ignored groups"`
              : "No duplicate groups were ignored",
        });
      } catch (err) {
        handleError(err);
      }
    },
    async unignoreGroup(hash) {
      if (!this.canMutate || this.ignoredBusy) return;
      const accountId = this.currentAccountId;
      this.ignoredBusy = true;
      try {
        await axios.post(
          `${this.serverUrl}/accounts/${accountId}/analysis/duplicates/unignore`,
          { hashes: [hash] },
          await AuthService.getAuthHeader(),
        );
        this.ignoredGroups = this.ignoredGroups.filter(
          (ignore) => ignore.hash !== hash,
        );
        DuplicateCountService.invalidate(accountId);
        await this.refreshLoaded();
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          text: "Duplicate group restored to the list",
        });
      } catch (err) {
        handleError(err);
      } finally {
        this.ignoredBusy = false;
      }
    },
    onSearchFilterChanged: debounce(function () {
      this.activeFilter = this.analysisFilter.trim();
    }, 300),
  },
};
</script>

<style scoped>
/* ── Content wrapper (prevents grid row overflow) ───── */
.duplicate-gallery-content {
  min-height: 0;
  overflow-y: auto;
}

/* ── Toolbar: count badge + filter input ─────────────────── */
.duplicate-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  align-items: start;
  gap: var(--space-md);
}
.duplicate-filter-input {
  min-width: 0;
}
.duplicate-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.duplicate-toolbar-actions button,
.duplicate-toolbar-actions kbd {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-base);
}

@media (max-width: 720px) {
  .duplicate-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
}

.duplicate-status {
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-text-secondary);
}
.duplicate-offline-note {
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-warning);
}

/* ── Undo banner ─────────────────────────────────────────── */
.duplicate-undo-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: var(--font-base);
}
.duplicate-undo-banner button {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
}

/* ── Ignored groups panel ────────────────────────────────── */
.duplicate-ignored-panel {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-bg-secondary);
}
.duplicate-ignored-panel summary {
  cursor: pointer;
  color: var(--color-text);
  font-size: var(--font-body);
}
.duplicate-ignored-empty {
  margin: var(--space-sm) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-base);
}
.duplicate-ignored-list {
  list-style: none;
  margin: var(--space-sm) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.duplicate-ignored-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-base);
}
.duplicate-ignored-name {
  font-weight: 600;
  word-break: break-all;
}
.duplicate-ignored-meta {
  color: var(--color-text-secondary);
}
.duplicate-ignored-list button {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-sm);
}

/* ── Duplicate card grid ─────────────────────────────────── */
.duplicate-card-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13em, 1fr));
  gap: var(--space-base);
  align-items: start;
  margin-top: var(--space-sm);
}
.duplicate-group-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}
.duplicate-group-card--selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}
.duplicate-group-select {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-sm);
}
.duplicate-group-select label {
  margin: 0;
  color: var(--color-text-secondary);
}
.duplicate-card-thumb {
  position: relative;
  cursor: pointer;
  height: 8em;
  border-radius: var(--radius-md);
  overflow: hidden;
}
.duplicate-keep-line {
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-text);
  line-height: 1.35;
  word-break: break-word;
}
.duplicate-group-meta {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
}
.duplicate-card-paths {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.duplicate-card-path {
  font-size: var(--font-xs);
  color: var(--color-text-secondary);
  word-break: break-all;
  line-height: 1.3;
}
.duplicate-review-btn {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-sm);
}
.duplicate-load-more {
  margin: var(--space-base) 0;
}
.duplicate-end-note {
  margin: var(--space-base) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-sm);
}

/* ── Infinite scroll sentinel ────────────────────────────── */
.sentinel {
  height: 1px;
  width: 100%;
}

/* ── Empty state ──────────────────────────────────── */
.duplicate-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-base);
  padding: var(--space-3xl) var(--space-2xl);
  color: var(--color-text-secondary);
  text-align: center;
}
.duplicate-empty-state i {
  font-size: 3em;
}
.duplicate-empty-state p {
  margin: 0;
}
</style>
