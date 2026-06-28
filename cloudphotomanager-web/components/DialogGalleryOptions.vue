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
  padding: var(--space-xs) 0;
}
fieldset label {
  display: block;
  margin-bottom: var(--space-sm);
}
footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
  margin-top: var(--space-base);
}
</style>
