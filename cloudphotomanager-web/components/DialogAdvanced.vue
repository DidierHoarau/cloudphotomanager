<template>
  <dialog open>
    <article>
      <header>
        <a href="#close" aria-label="Close" class="close" v-on:click="clickedClose()"></a>
        Advanced
      </header>
      <p>{{ files.length }} file(s) selected...</p>
      <legend>
        Outakes<br />
        <small>"Outtakes" are photos that are classified as secondary int he album.</small>
      </legend>
      <button v-on:click="doActionSetOuttake()">Mark As Outtakes</button>
      <button v-on:click="doActionUnSetOuttake()">Un-Mark As Outtakes</button>
    </article>
  </dialog>
</template>

<script>
import { AuthService } from "~~/services/AuthService";
import { FileUtils } from "~~/services/FileUtils";
import { find } from "lodash";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  props: {
    files: {},
    selectedFiles: Array,
  },
  data() {
    return {
      daySelections: [],
    };
  },
  async created() {
    for (const file of this.files) {
      const dateString = new Date(file.dateMedia).toLocaleDateString();
      let daySelection = find(this.daySelections, { day: dateString });
      if (!daySelection) {
        daySelection = { day: dateString, files: [], selected: false };
        this.daySelections.push(daySelection);
      }
      daySelection.files.push(file);
    }
  },
  methods: {
    async clickedClose() {
      this.$emit("onDone", {});
    },
    async doActionSetOuttake() {
      this.loading = true;
      let accountId = "";
      SyncStore().markOperationInProgress();
      const fileIdNames = [];
      for (const file of this.files) {
        if (file.filename.indexOf("-outtake") < 0) {
          accountId = file.accountId;
          fileIdNames.push({
            id: file.id,
            filename: `${FileUtils.getWithoutExtention(file)}-outtake.${FileUtils.getExtention(file)}`,
          });
        }
      }
      if (fileIdNames.length > 0) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
            { fileIdNames },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            this.$emit("onDone", { status: "invalidated" });
          })
          .catch(handleError);
      }
      this.loading = false;
    },
    async doActionUnSetOuttake() {
      this.loading = true;
      let accountId = "";
      SyncStore().markOperationInProgress();
      const fileIdNames = [];
      for (const file of this.files) {
        if (file.filename.indexOf(`-outtake.${FileUtils.getExtention(file)}`) > 0) {
          accountId = file.accountId;
          fileIdNames.push({
            id: file.id,
            filename: file.filename.replace(
              `-outtake.${FileUtils.getExtention(file)}`,
              `.${FileUtils.getExtention(file)}`
            ),
          });
        }
      }
      if (fileIdNames.length > 0) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
            { fileIdNames },
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            this.$emit("onDone", { status: "invalidated" });
          })
          .catch(handleError);
      }
      this.loading = false;
    },
  },
};
</script>

<style scoped>
small {
  opacity: 50%;
}
</style>
