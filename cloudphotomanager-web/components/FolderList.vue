<template>
  <div class="folder-component-layout">
    <input
      v-model="folderFilter"
      type="search"
      name="search"
      placeholder="Filter Folder"
      aria-label="Search"
      class="folder-component-layout-filter"
    />
    <Loading v-if="foldersStore.loading" class="folder-component-layout-list" />
    <div v-else class="folder-component-layout-list">
      <template
        v-for="(folder, index) in foldersStore.folders"
        :key="folder.id"
      >
        <div
          v-if="isVisible(folder)"
          class="folder-layout"
          :class="{ 'source-active': selectedFolderId == folder.id }"
          :ref="'folder-' + folder.id"
        >
          <span
            @click="toggleFolderCollapsed(index)"
            class="folder-layout-indent"
          >
            <span v-if="!folderFilter" v-html="folder.indentation"></span>
            <i v-if="folder.children === 0" class="bi bi-images"></i>
            <i v-else-if="folder.isCollapsed" class="bi bi-folder"></i>
            <i v-else class="bi bi-folder2-open"></i>
          </span>
          <div @click="selectFolder(folder)" class="folder-layout-name">
            <span v-if="!folder.isLabel"
              ><i :class="'bi bi-' + folder.icon"></i>&nbsp;</span
            >
            <span v-if="!folderFilter">{{ folder.name }}</span>
            <span v-else>{{ folder.folderpath }}</span>
          </div>
          <div @click="selectFolder(folder)" class="folder-layout-count">
            {{ folder.counts }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
const foldersStore = FoldersStore();
</script>

<script>
import { EventBus, EventTypes } from "~~/services/EventBus";

export default {
  props: {
    accountId: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      folderFilter: "",
      selectedFolderId: null,
      _folderUpdatedHandler: null,
      _routeWatcherStop: null,
    };
  },
  computed: {
    normalizedFilter() {
      return this.folderFilter.toLowerCase().trim();
    },
  },
  async created() {
    this._folderUpdatedHandler = () => FoldersStore().fetch();
    EventBus.on(EventTypes.FOLDER_UPDATED, this._folderUpdatedHandler);

    await FoldersStore().fetch();
    const initialFolderId = useRoute().query.folderId;
    if (initialFolderId) {
      this.activateFolder(initialFolderId);
    }

    this._routeWatcherStop = watch(
      () => useRoute().query.folderId,
      (folderId) => {
        this.selectedFolderId = folderId || null;
        if (folderId) {
          FoldersStore().expandToFolder(folderId);
        }
      },
    );
  },
  unmounted() {
    if (this._folderUpdatedHandler) {
      EventBus.off(EventTypes.FOLDER_UPDATED, this._folderUpdatedHandler);
    }
    if (this._routeWatcherStop) {
      this._routeWatcherStop();
    }
  },
  methods: {
    activateFolder(folderId) {
      this.selectedFolderId = folderId;
      FoldersStore().expandToFolder(folderId);
      this.$nextTick(() => {
        setTimeout(() => this.scrollToFolder(folderId), 300);
      });
    },
    scrollToFolder(folderId) {
      const element = this.$refs["folder-" + folderId];
      const el = Array.isArray(element) ? element[0] : element;
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    },
    selectFolder(folder) {
      this.$emit("onFolderSelected", { folder });
      this.selectedFolderId = folder.id;
    },
    isVisible(folder) {
      if (this.accountId && this.accountId !== folder.accountId) {
        return false;
      }
      if (this.normalizedFilter) {
        return folder.folderpath.toLowerCase().includes(this.normalizedFilter);
      }
      if (folder.folderpath === "/") {
        return true;
      }
      return folder.isVisible;
    },
    toggleFolderCollapsed(index) {
      FoldersStore().toggleFolderCollapsed(index);
    },
  },
};
</script>

<style scoped>
.folder-component-layout-filter {
  --pico-border-radius: 0rem;
}
@media (prefers-color-scheme: dark) {
  .source-active {
    background-color: #333;
  }
}
@media (prefers-color-scheme: light) {
  .source-active {
    background-color: #bbb;
  }
}

.folder-component-layout {
  display: grid;
  grid-template-rows: 1.6em 1fr;
  height: 100%;
}

.folder-component-layout-list {
  grid-row: 2;
  overflow-y: auto;
}

.folder-component-layout-filter {
  grid-row: 1;
  font-size: 0.7em;
  height: 100%;
}

.folder-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  padding: 0.3em 0.5em;
  max-width: 100%;
  text-align: left;
}
.source-name-indent {
  grid-column: 1;
  padding-right: 0.5em;
}
.folder-layout-name {
  grid-column: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.folder-layout-count {
  grid-column: 3;
  opacity: 0.2;
  font-size: 0.9em;
}
</style>
