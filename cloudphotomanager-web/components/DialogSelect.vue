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
        Selection
      </header>
      <fieldset>
        <legend>Per date:</legend>
        <label v-for="daySelection in daySelections" :key="daySelection.day"
          ><input
            v-model="daySelection.selected"
            type="checkbox"
            @change="onDaySelected()"
          />{{ daySelection.day }} ({{
            daySelection.files.length
          }}
          files)</label
        >
      </fieldset>
      <button v-on:click="doAction()">Done</button>
      <button v-on:click="doActionSelectAll()">Select All</button>
      <button v-on:click="doActionUnSelectAll()">Unselect All</button>
    </article>
  </dialog>
</template>

<script>
import { find } from "lodash";

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
    doActionSelectAll() {
      for (const file of this.files) {
        this.selectedFiles.push(file);
      }
      this.$emit("onDone", {});
    },
    doActionUnSelectAll() {
      while (this.selectedFiles.length > 0) {
        this.selectedFiles.pop();
      }
      this.$emit("onDone", {});
    },
    onDaySelected() {
      while (this.selectedFiles.length > 0) {
        this.selectedFiles.pop();
      }
      for (const daySelection of this.daySelections) {
        if (daySelection.selected) {
          for (const file of daySelection.files) {
            this.selectedFiles.push(file);
          }
        }
      }
    },
    async doAction() {
      this.$emit("onDone", {});
    },
  },
};
</script>

<style scoped></style>
