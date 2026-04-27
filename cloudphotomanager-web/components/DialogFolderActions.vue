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
footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
  margin-top: 1em;
}
</style>
