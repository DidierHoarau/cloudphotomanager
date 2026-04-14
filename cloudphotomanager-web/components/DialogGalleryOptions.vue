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
        Gallery Options
      </header>
      <fieldset>
        <label>
          <input type="checkbox" v-model="localIncludeSubFolders" />
          Include sub-folders
        </label>
      </fieldset>
      <legend>Sort Order</legend>
      <fieldset>
        <label>
          <input type="radio" v-model="localSortOrder" value="desc" />
          Newest first
        </label>
        <label>
          <input type="radio" v-model="localSortOrder" value="asc" />
          Oldest first
        </label>
      </fieldset>
      <footer>
        <button v-on:click="clickedSave()">Save</button>
        <button class="secondary outline" v-on:click="clickedClose()">
          Cancel
        </button>
      </footer>
    </article>
  </dialog>
</template>

<script>
export default {
  props: {
    includeSubFolders: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: String,
      default: "desc",
    },
  },
  data() {
    return {
      localIncludeSubFolders: this.includeSubFolders,
      localSortOrder: this.sortOrder,
    };
  },
  methods: {
    clickedClose() {
      this.$emit("onClose");
    },
    clickedSave() {
      this.$emit("onSave", {
        includeSubFolders: this.localIncludeSubFolders,
        sortOrder: this.localSortOrder,
      });
    },
  },
};
</script>

<style scoped>
fieldset {
  border: none;
  padding: 0.3em 0;
}
fieldset label {
  display: block;
  margin-bottom: 0.4em;
}
footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
  margin-top: 1em;
}
</style>
