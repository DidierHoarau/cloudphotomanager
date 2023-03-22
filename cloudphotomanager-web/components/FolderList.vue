<template>
  <div>
    <input v-model="folderFilter" type="text" class="folder-filter" />
    <Loading v-if="foldersStore.loading" class="folder-list-layout" />
    <div v-for="(folder, index) in foldersStore.folders" v-bind:key="folder.name">
      <!-- v-if="folder.isVisible" -->
      <div class="folder-list-layout" :class="{ 'source-active': selectFolderIndex == index }">
        <span v-on:click="toggleLabelCollapsed(folder, index)" class="folder-list-indent">
          <span v-html="folder.indentation"></span>
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
  data() {
    return {
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
  text-align: left;
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
.folder-filter {
  font-size: 0.7em;
  height: 3em;
}
</style>
