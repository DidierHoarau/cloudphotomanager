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
import { groupBy } from "lodash";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  props: {
    files: {},
    selectedFiles: Array,
  },
  methods: {
    async clickedClose() {
      this.$emit("onDone", {});
    },
    async doActionRebuildCache() {
      this.loading = true;
      try {
        const groups = groupBy(this.files, "accountId");
        let succeeded = false;
        for (const accountId of Object.keys(groups)) {
          const fileIdList = groups[accountId].map((file) => file.id);
          try {
            await axios.post(
              `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileCacheDelete`,
              { fileIdList },
              await AuthService.getAuthHeader(),
            );
            succeeded = true;
          } catch (err) {
            handleError(err);
          }
        }
        if (succeeded) {
          this.$emit("onDone", { status: "invalidated" });
        }
      } finally {
        this.loading = false;
      }
    },
    async doActionSetOuttake() {
      this.loading = true;
      try {
        const candidates = this.files.filter(
          (file) => !FileUtils.isOuttake(file),
        );
        const groups = groupBy(candidates, "accountId");
        let succeeded = false;
        for (const accountId of Object.keys(groups)) {
          const fileIdNames = groups[accountId].map((file) => ({
            id: file.id,
            filename: `${FileUtils.getWithoutExtention(file)}-outtake.${FileUtils.getExtention(file)}`,
          }));
          SyncStore().markFilesAsPending(fileIdNames.map((f) => f.id));
          SyncStore().markOperationInProgress();
          try {
            await axios.post(
              `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
              { fileIdNames },
              await AuthService.getAuthHeader(),
            );
            succeeded = true;
          } catch (err) {
            handleError(err);
          }
        }
        if (succeeded) {
          this.$emit("onDone", { status: "invalidated" });
        }
      } finally {
        this.loading = false;
      }
    },
    async doActionUnSetOuttake() {
      this.loading = true;
      try {
        const candidates = this.files.filter((file) =>
          FileUtils.isOuttake(file),
        );
        const groups = groupBy(candidates, "accountId");
        let succeeded = false;
        for (const accountId of Object.keys(groups)) {
          const fileIdNames = groups[accountId].map((file) => {
            const ext = FileUtils.getExtention(file);
            return {
              id: file.id,
              filename: file.filename.replace(`-outtake.${ext}`, `.${ext}`),
            };
          });
          SyncStore().markFilesAsPending(fileIdNames.map((f) => f.id));
          SyncStore().markOperationInProgress();
          try {
            await axios.post(
              `${(await Config.get()).SERVER_URL}/accounts/${accountId}/files/batch/operations/fileRename`,
              { fileIdNames },
              await AuthService.getAuthHeader(),
            );
            succeeded = true;
          } catch (err) {
            handleError(err);
          }
        }
        if (succeeded) {
          this.$emit("onDone", { status: "invalidated" });
        }
      } finally {
        this.loading = false;
      }
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
  padding: var(--space-sm) 0;
}

.outtakes-section {
  margin-bottom: var(--space-base);
}

.outtakes-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.outtakes-btn {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-body);
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
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
