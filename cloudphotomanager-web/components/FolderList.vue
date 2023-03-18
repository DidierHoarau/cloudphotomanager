<template>
  <div>
    <div v-for="(folder, index) in foldersStore.folders" v-bind:key="folder.name">
      <!-- v-if="folder.isVisible" -->
      <div class="folder-list-layout" :class="{ 'source-active': foldersStore.selectedIndex == index }">
        <span v-on:click="toggleLabelCollapsed(folder, index)" class="folder-list-indent">
          <span v-html="getIndentation(folder)"></span>
          <i v-if="folder.isLabel && folder.isCollapsed" class="bi bi-caret-right-fill"></i>
          <i v-else class="bi bi-folder2-open"></i>
        </span>
        <div v-on:click="selectFolder(folder, index)" class="folder-list-name">
          <span v-if="!folder.isLabel"><i :class="'bi bi-' + folder.icon"></i>&nbsp;</span>
          {{ folder.name }}
        </div>
        <div v-on:click="selectFolder(folder, index)" class="folder-list-count">
          {{ folder.childrenCount }}
        </div>
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
    if (!FoldersStore().selectedIndex) {
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
      FoldersStore().selectedIndex = index;
      EventBus.emit(EventTypes.FOLDER_SELECTED, folder);
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
    getIndentation(folder) {
      if (folder.folderpath === "/") {
        return "";
      }
      let indent = "";
      for (let i = 0; i < folder.folderpath.split("/").length - 1; i++) {
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

.folder-list-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  padding: 0.3em 0.5em;
  max-width: 100%;
}
.source-name-indent {
  grid-column: 1;
  padding-right: 0.5em;
}
.folder-list-name {
  grid-column: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.folder-list-count {
  grid-column: 3;
  opacity: 0.2;
  font-size: 0.9em;
}
</style>
