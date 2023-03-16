<template>
  <div class="gallery-layout page">
    <div class="gallery-actions actions">
      <i class="bi bi-arrow-clockwise" v-on:click="refresh()"></i>
      <i class="bi bi-caret-up-square gallery-actions-menu-toggle" v-if="menuOpened" v-on:click="openListMenu()"></i>
      <i class="bi bi-caret-down-square gallery-actions-menu-toggle" v-else v-on:click="openListMenu()"></i>
    </div>
    <div class="gallery-folders" :class="{ 'gallery-folders-closed': !menuOpened }">
      <FolderList />
    </div>
    <div class="gallery-files-actions actions">
      <!-- <NuxtLink v-if="sourceItemsStore.selectedSource" :to="'/gallery/' + sourceItemsStore.selectedSource"
        ><i class="bi bi-pencil-square"></i
      ></NuxtLink>
      <i v-if="sourceItemsStore.sourceItems.length > 0" v-on:click="markAllRead()" class="bi bi-archive"></i>
      <i v-if="sourceItemsStore.filterStatus == 'unread'" v-on:click="toggleUnreadFIlter()" class="bi bi-eye-slash"></i>
      <i v-else v-on:click="toggleUnreadFIlter()" class="bi bi-eye"></i> -->
    </div>
    <div class="gallery-file-list">
      <div class="card gallery-file" v-for="file in files" v-bind:key="file.id">
        <div class="gallery-file-name">
          {{ file.filename }}
        </div>
        <div class="gallery-file-image">
          <img :src="serverUrl + '/accounts/' + accountSelected + '/files/' + file.id + '/thumbnail'" />
        </div>
        <div class="gallery-file-info">
          {{ file.filepath }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import * as _ from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      files: [],
      serverUrl: "",
      menuOpened: true,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      FoldersStore().fetch();
    }
    EventBus.on(EventTypes.FOLDER_SELECTED, (message) => {
      this.fetchFiles(message.accountId, message.folderpath);
    });
  },
  methods: {
    async fetchFiles(accountId, folderpath) {
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/accounts/${AccountsStore().accountSelected}/files/search`,
          {
            accountId,
            folderpath,
          },
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          this.files = _.sortBy(res.data.files, ["name"]);
        })
        .catch(handleError);
    },
    openListMenu() {
      this.menuOpened = !this.menuOpened;
    },
  },
};
</script>

<style scoped>
.gallery-file-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: 1em;
}
.gallery-file {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto;
}
.gallery-file-name {
  grid-row: 1;
  word-break: break-all;
}
.gallery-file-image {
  grid-row: 2;
  word-break: break-all;
}
.gallery-file-image img {
  width: 100%;
}
.gallery-file-info {
  grid-row: 3;
  font-size: 0.7em;
  word-break: break-all;
}

@media (min-width: 701px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: 4em 2.5em 1fr;
    grid-template-columns: auto 1fr 1fr;
    column-gap: 1em;
  }
  .gallery-files-actions {
    grid-row: 2;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .gallery-file-list {
    overflow: auto;
    grid-row: 3;
    grid-column-start: 2;
    grid-column-end: span 2;
  }
  .gallery-header {
    grid-row: 1;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders {
    width: 30vw;
    max-width: 20em;
    overflow: auto;
    height: auto;
    grid-row-start: 2;
    grid-row-end: span 2;
    grid-column: 1;
  }
  .gallery-actions-menu-toggle {
    visibility: hidden;
    font-size: 0px;
    padding: 0px;
    margin: 0px;
  }
}

@media (max-width: 700px) {
  .gallery-layout {
    display: grid;
    grid-template-rows: 2.5em 1fr 2.5em 2fr;
    grid-template-columns: auto auto;
    column-gap: 1em;
  }
  .gallery-files-actions {
    grid-row: 3;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-file-list {
    overflow: scroll;
    grid-row: 4;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders {
    overflow: auto;
    height: 30vh;
    grid-row: 2;
    grid-column-start: 1;
    grid-column-end: span 2;
  }
  .gallery-folders-closed {
    height: 0px !important;
  }
}

@media (prefers-color-scheme: dark) {
  .source-active {
    background-color: #333;
  }
  .gallery-folders {
    background-color: #33333333;
  }
}
@media (prefers-color-scheme: light) {
  .source-active {
    background-color: #bbb;
  }
  .gallery-folders {
    background-color: #aaaaaa33;
  }
}
</style>
