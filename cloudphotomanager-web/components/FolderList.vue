<template>
  <div class="folder-component-layout">
    <input v-model="folderFilter" type="text" class="folder-component-layout-filter" v-on:input="filterFolders" />
    <Loading v-if="foldersStore.loading" class="folder-component-layout-list" />
    <div v-else class="folder-component-layout-list">
      <div v-for="(folder, index) in foldersStore.folders" v-bind:key="folder.name">
        <div
          v-if="matchFolderFilter(folder.name)"
          class="folder-layout"
          :class="{ 'source-active': selectFolderIndex == index }"
        >
          <span v-on:click="toggleLabelCollapsed(folder, index)" class="folder-layout-indent">
            <span v-if="!folderFilter" v-html="folder.indentation"></span>
            <i v-if="folder.isLabel && folder.isCollapsed" class="bi bi-caret-right-fill"></i>
            <i v-else class="bi bi-folder2-open"></i>
          </span>
          <div v-on:click="selectFolder(folder, index)" class="folder-layout-name">
            <span v-if="!folder.isLabel"><i :class="'bi bi-' + folder.icon"></i>&nbsp;</span>
            <span v-if="!folderFilter">{{ folder.name }}</span>
            <span v-else>{{ folder.folderpath }}</span>
          </div>
          <div v-on:click="selectFolder(folder, index)" class="folder-layout-count">
            {{ folder.childrenCount }}
          </div>
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
  data() {
    return {
      folderFilter: "",
      selectFolderIndex: -1,
    };
  },
  async created() {
    EventBus.on(EventTypes.FOLDERS_UPDATED, (message) => {
      FoldersStore().fetch();
    });
    FoldersStore().fetch();
  },
  methods: {
    selectFolder(folder, index) {
      this.$emit("onFolderSelected", { folder });
      this.selectFolderIndex = index;
    },
    filterFolders() {},
    matchFolderFilter(folderName) {
      if (!this.folderFilter) {
        return true;
      }
      return folderName.toLowerCase().indexOf(this.folderFilter.toLowerCase()) >= 0;
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
