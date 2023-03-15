<template>
  <div class="page">
    <p>galery</p>
    <div class="gallery-file-list">
      <div class="card gallery-file-layout" v-for="file in files" v-bind:key="file.id">
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

    {{}}
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
      accountSelected: "",
      files: [],
      serverUrl: "",
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      this.accountSelected = AccountsStore().accounts[0].id;
      this.fetchFiles();
    }
  },
  methods: {
    async fetchFiles() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/accounts/${this.accountSelected}/files`,
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          this.files = _.sortBy(res.data.files, ["name"]);
        })
        .catch(handleError);
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
.gallery-file-layout {
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
</style>
