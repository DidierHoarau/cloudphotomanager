<template>
  <dialog open>
    <article class="dialog-standard">
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedClose()"
        ></a>
        Advanced
      </header>
      <div class="dialog-standard-body">
        <p>{{ files.length }} file(s) selected...</p>
        <fieldset class="outtakes-section">
          <legend>
            Outtakes
            <br />
            <small
              >"Outtakes" are photos that are classified as secondary in the
              album.</small
            >
          </legend>
          <div class="outtakes-buttons">
            <button 
              class="outtakes-btn outtakes-mark"
              v-on:click="doActionSetOuttake()"
            >
              Mark As Outtakes
            </button>
            <button 
              class="outtakes-btn outtakes-unmark"
              v-on:click="doActionUnSetOuttake()"
            >
              Un-Mark As Outtakes
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Rebuild Cache</legend>
          <button v-on:click="doActionRebuildCache()">Rebuild Cache</button>
        </fieldset>
      </div>
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
    async doActionRebuildCache() {
      this.loading = true;
      let accountId = "";
      const fileIdList = [];
      for (const file of this.files) {
        accountId = file.accountId;
        fileIdList.push(file.id);
      }
      if (fileIdList.length > 0) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileCacheDelete`,
            { fileIdList },
            await AuthService.getAuthHeader(),
          )
          .then((res) => {
            this.$emit("onDone", { status: "invalidated" });
          })
          .catch(handleError);
      }
      this.loading = false;
    },
    async doActionSetOuttake() {
      this.loading = true;
      let accountId = "";
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
        SyncStore().markFilesAsPending(fileIdNames.map((f) => f.id));
        SyncStore().markOperationInProgress();
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
            { fileIdNames },
            await AuthService.getAuthHeader(),
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
      const fileIdNames = [];
      for (const file of this.files) {
        if (
          file.filename.indexOf(`-outtake.${FileUtils.getExtention(file)}`) > 0
        ) {
          accountId = file.accountId;
          fileIdNames.push({
            id: file.id,
            filename: file.filename.replace(
              `-outtake.${FileUtils.getExtention(file)}`,
              `.${FileUtils.getExtention(file)}`,
            ),
          });
        }
      }
      if (fileIdNames.length > 0) {
        SyncStore().markFilesAsPending(fileIdNames.map((f) => f.id));
        SyncStore().markOperationInProgress();
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
            { fileIdNames },
            await AuthService.getAuthHeader(),
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

fieldset {
  border: none;
  padding: 0.5em 0;
}

.outtakes-section {
  margin-bottom: 1em;
}

.outtakes-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5em;
  margin-top: 0.5em;
}

.outtakes-btn {
  padding: 0.4em 0.6em;
  font-size: 0.9em;
  border: 1px solid currentColor;
  border-radius: 0.3em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.outtakes-mark {
  background-color: var(--form-element-checked-background-color);
}

.outtakes-unmark {
  background-color: var(--form-element-background-color);
}

.outtakes-btn:hover {
  opacity: 0.8;
}
</style>
