<template>
  <div>
    <div v-for="(folder, index) in foldersStore.folders" v-bind:key="folder.name">
      <!-- v-if="folder.isVisible" -->
      <div class="source-name-layout" :class="{ 'source-active': foldersStore.selectedIndex == index }">
        <span v-on:click="toggleLabelCollapsed(folder, index)" class="folder-name-indent">
          <span v-html="getIndentation(folder)"></span>
          <i v-if="folder.isLabel && folder.isCollapsed" class="bi bi-caret-right-fill"></i>
          <i v-else-if="folder.isLabel" class="bi bi-caret-down-fill"></i>
        </span>
        <div v-on:click="selectFolder(folder, index)" class="folder-name-name">
          <span v-if="!folder.isLabel"><i :class="'bi bi-' + folder.icon"></i>&nbsp;</span>
          {{ folder.folderpath }}
        </div>
        <div v-on:click="selectFolder(folder, index)" class="folder-name-count">{{ folder.unreadCount }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
const foldersStore = FoldersStore();
</script>

<script>
import * as _ from "lodash";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  async created() {
    FoldersStore().fetch();
    if (!SourceItemsStore().selectedSource) {
      this.loadAllItems();
      FoldersStore().selectedIndex = 0;
    }
    FoldersStore().fetch();
    EventBus.on(EventTypes.ITEMS_UPDATED, (message) => {
      SourcesStore().fetchCounts();
    });
    EventBus.on(EventTypes.SOURCES_UPDATED, (message) => {
      SourcesStore().fetch();
    });
  },
  methods: {
    selectFolder(folder, index) {
      FoldersStore().select(folder);
      EventBus.emit(EventTypes.FOLDER_SELECTED, folder);

      // SourcesStore().selectedIndex = index;
      // if (source.isRoot) {
      //   this.loadAllItems();
      // } else if (source.isLabel) {
      //   this.loadLabelItems(source);
      // } else {
      //   this.loadSourceItems(source);
      // }
    },
    async loadSourceItems(source) {
      const sourceItemsStore = SourceItemsStore();
      sourceItemsStore.selectedSource = source.sourceId;
      sourceItemsStore.page = 1;
      sourceItemsStore.searchCriteria = "sourceId";
      sourceItemsStore.searchCriteriaValue = source.sourceId;
      sourceItemsStore.filterStatus = "unread";
      sourceItemsStore.fetch();
    },
    async loadLabelItems(source) {
      const sourceItemsStore = SourceItemsStore();
      sourceItemsStore.selectedSource = null;
      sourceItemsStore.page = 1;
      sourceItemsStore.searchCriteria = "labelName";
      sourceItemsStore.searchCriteriaValue = source.labelName;
      sourceItemsStore.filterStatus = "unread";
      sourceItemsStore.fetch();
    },
    async loadAllItems() {
      const sourceItemsStore = SourceItemsStore();
      sourceItemsStore.selectedSource = null;
      sourceItemsStore.page = 1;
      sourceItemsStore.searchCriteria = "all";
      sourceItemsStore.filterStatus = "unread";
      sourceItemsStore.fetch();
    },
    async loadSavedItems(index) {
      SourcesStore().selectedIndex = -2;
      const sourceItemsStore = SourceItemsStore();
      sourceItemsStore.selectedSource = null;
      sourceItemsStore.page = 1;
      sourceItemsStore.searchCriteria = "lists";
      sourceItemsStore.filterStatus = "all";
      sourceItemsStore.fetch();
    },
    isLabelDisplayed(index) {
      if (!SourcesStore().sourceLabels[index].labelName) {
        return false;
      }
      if (index === 0) {
        return true;
      }
      if (SourcesStore().sourceLabels[index].labelName === SourcesStore().sourceLabels[index - 1].labelName) {
        return false;
      }
      return true;
    },
    getIndentation(source) {
      let indent = "";
      for (let i = 0; i < source.depth; i++) {
        indent += "&nbsp;&nbsp;&nbsp;&nbsp;";
      }
      return indent;
    },
    toggleLabelCollapsed(label, index) {
      SourcesStore().toggleLabelCollapsed(index);
    },
  },
};
</script>

<style scoped>
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

.source-name-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  padding: 0.3em 0.5em;
}
.source-name-indent {
  grid-column: 1;
  padding-right: 0.5em;
}
.source-name-name {
  grid-column: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-name-count {
  grid-column: 3;
}
</style>
