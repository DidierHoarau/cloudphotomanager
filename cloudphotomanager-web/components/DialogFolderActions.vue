<template>
  <dialog open>
    <article>
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedClose()"
        ></a>
        Folder Actions
      </header>
      <fieldset>
        <legend>Refresh Options</legend>
        <button class="secondary outline" v-on:click="doRefreshFolder()">
          <i class="bi bi-arrow-clockwise"></i> Refresh (Current Folder)
        </button>
        <button class="secondary outline" v-on:click="doDeepRefresh()">
          <i class="bi bi-arrow-repeat"></i> Refresh All (Deep Scan)
        </button>
      </fieldset>
      <fieldset v-if="!isRoot">
        <legend>Rename Folder</legend>
        <div v-if="!renameMode">
          <button class="secondary outline" v-on:click="startRename()">
            <i class="bi bi-pencil"></i> Rename...
          </button>
        </div>
        <div v-else class="rename-form">
          <input
            ref="renameInput"
            v-model="newName"
            type="text"
            placeholder="New folder name"
            v-on:keyup.enter="doRename()"
          />
          <div class="rename-actions">
            <button class="secondary" v-on:click="doRename()">
              <i class="bi bi-check2"></i> Save
            </button>
            <button class="secondary outline" v-on:click="cancelRename()">
              Cancel
            </button>
          </div>
        </div>
      </fieldset>
      <footer>
        <button class="secondary outline" v-on:click="clickedClose()">
          Close
        </button>
      </footer>
    </article>
  </dialog>
</template>

<script>
export default {
  props: {
    folder: {
      type: Object,
      required: true,
      default: () => ({}),
    },
  },
  data() {
    return {
      renameMode: false,
      newName: "",
    };
  },
  computed: {
    isRoot() {
      return !this.folder || !this.folder.name || this.folder.parentIndex < 0;
    },
  },
  methods: {
    clickedClose() {
      this.$emit("onDone", {});
    },
    doRefreshFolder() {
      this.$emit("onDone", { action: "refresh" });
    },
    doDeepRefresh() {
      this.$emit("onDone", { action: "deep-refresh" });
    },
    startRename() {
      this.newName = this.folder.name || "";
      this.renameMode = true;
      this.$nextTick(() => {
        if (this.$refs.renameInput) {
          this.$refs.renameInput.focus();
          this.$refs.renameInput.select?.();
        }
      });
    },
    cancelRename() {
      this.renameMode = false;
      this.newName = "";
    },
    doRename() {
      const trimmed = (this.newName || "").trim();
      if (!trimmed || trimmed === this.folder.name) {
        this.cancelRename();
        return;
      }
      if (trimmed.includes("/") || trimmed === "." || trimmed === "..") {
        return;
      }
      this.$emit("onDone", { action: "rename", newName: trimmed });
    },
  },
};
</script>

<style scoped>
fieldset {
  border: none;
  padding: 0.3em 0;
}
button {
  display: block;
  margin-bottom: 0.5em;
  width: 100%;
}
.rename-form input {
  width: 100%;
  margin-bottom: 0.5em;
}
.rename-actions {
  display: flex;
  gap: 0.5em;
}
.rename-actions button {
  flex: 1;
  margin-bottom: 0;
}
footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
  margin-top: 1em;
}
</style>
