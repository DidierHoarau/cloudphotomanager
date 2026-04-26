<template>
  <dialog open>
    <article class="dialog-standard dialog-select">
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedClose()"
        ></a>
        Selection
      </header>
      <div class="dialog-standard-body">
        <div class="select-mode">
          <label>
            <input v-model="selectionMode" type="radio" value="date" /> By date
          </label>
          <label>
            <input v-model="selectionMode" type="radio" value="type" /> By type
          </label>
          <label>
            <input v-model="selectionMode" type="radio" value="duplicates" />
            Known duplicates
          </label>
        </div>

        <fieldset v-if="selectionMode === 'date'">
          <legend>By date</legend>

          <details class="select-shortcuts" open>
            <summary>Year shortcuts</summary>
            <label
              v-for="yearSelection in yearSelections"
              :key="yearSelection.yearKey"
            >
              <input
                v-model="yearSelection.selected"
                type="checkbox"
                @change="onYearSelected(yearSelection)"
              />
              {{ yearSelection.label }} ({{ yearSelection.files.length }} files)
            </label>
          </details>

          <details class="select-shortcuts" open>
            <summary>Month shortcuts</summary>
            <label
              v-for="monthSelection in monthSelections"
              :key="monthSelection.monthKey"
            >
              <input
                v-model="monthSelection.selected"
                type="checkbox"
                @change="onMonthSelected(monthSelection)"
              />
              {{ monthSelection.label }} ({{ monthSelection.files.length }}
              files)
            </label>
          </details>

          <details class="select-dates" open>
            <summary>Dates</summary>
            <label
              v-for="daySelection in daySelections"
              :key="daySelection.dayKey"
            >
              <input
                v-model="daySelection.selected"
                type="checkbox"
                @change="onDaySelected()"
              />
              {{ daySelection.label }} ({{ daySelection.files.length }} files)
            </label>
          </details>
        </fieldset>

        <fieldset v-if="selectionMode === 'type'">
          <legend>By type</legend>
          <label
            v-for="typeSelection in typeSelections"
            :key="typeSelection.type"
          >
            <input
              v-model="typeSelection.selected"
              type="checkbox"
              @change="onTypeSelected()"
            />
            {{ typeSelection.label }} ({{ typeSelection.files.length }} files)
          </label>
        </fieldset>

        <fieldset v-if="selectionMode === 'duplicates'">
          <legend>Known duplicates</legend>
          <p v-if="duplicateSelections.length === 0" class="helper-text">
            No known duplicates in this folder.
          </p>
          <label
            v-for="duplicateSelection in duplicateSelections"
            v-else
            :key="duplicateSelection.file.id"
            class="duplicate-row"
          >
            <input
              v-model="duplicateSelection.selected"
              type="checkbox"
              @change="onDuplicatesSelected()"
            />
            <span class="duplicate-row-text"
              >{{ duplicateSelection.file.filename }}
            </span>
            <small class="duplicate-row-meta">
              {{ formatDate(duplicateSelection.file.dateMedia) }} -
              {{ duplicateSelection.duplicateCount }} copies
            </small>
          </label>
        </fieldset>
      </div>

      <footer class="dialog-standard-footer">
        <button class="secondary outline" v-on:click="doActionUnSelectAll()">
          Unselect All
        </button>
        <button class="secondary" v-on:click="doActionSelectAll()">
          Select All
        </button>
        <button v-on:click="doAction()">Done</button>
      </footer>
    </article>
  </dialog>
</template>

<script>
import { find } from "lodash";
import { FileUtils } from "~~/services/FileUtils";

export default {
  props: {
    files: {},
    selectedFiles: Array,
    duplicateCounts: {
      type: Object,
      required: false,
      default: () => ({}),
    },
  },
  data() {
    return {
      selectionMode: "date",
      daySelections: [],
      monthSelections: [],
      yearSelections: [],
      typeSelections: [],
      duplicateSelections: [],
    };
  },
  async created() {
    const monthLabelFormatter = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    });

    for (const file of this.files) {
      const rawDate = new Date(file.dateMedia || file.dateSync || 0);
      const dateValue = Number.isFinite(rawDate.getTime())
        ? rawDate
        : new Date(0);
      const dateString = dateValue.toLocaleDateString();
      const dayKey = dateValue.toISOString().split("T")[0];
      const monthKey = dayKey.slice(0, 7);
      const yearKey = dayKey.slice(0, 4);

      let daySelection = find(this.daySelections, { dayKey });
      if (!daySelection) {
        daySelection = {
          dayKey,
          label: dateString,
          monthKey,
          yearKey,
          files: [],
          selected: false,
        };
        this.daySelections.push(daySelection);
      }
      daySelection.files.push(file);

      let monthSelection = find(this.monthSelections, { monthKey });
      if (!monthSelection) {
        monthSelection = {
          monthKey,
          label: monthLabelFormatter.format(dateValue),
          files: [],
          selected: false,
        };
        this.monthSelections.push(monthSelection);
      }
      monthSelection.files.push(file);

      let yearSelection = find(this.yearSelections, { yearKey });
      if (!yearSelection) {
        yearSelection = {
          yearKey,
          label: yearKey,
          files: [],
          selected: false,
        };
        this.yearSelections.push(yearSelection);
      }
      yearSelection.files.push(file);

      const type = this.getType(file);
      let typeSelection = find(this.typeSelections, { type });
      if (!typeSelection) {
        typeSelection = {
          type,
          label: this.getTypeLabel(type),
          files: [],
          selected: false,
        };
        this.typeSelections.push(typeSelection);
      }
      typeSelection.files.push(file);

      const duplicateCount = Number(this.duplicateCounts[file.id] || 0);
      if (duplicateCount > 1) {
        this.duplicateSelections.push({
          file,
          duplicateCount,
          selected: false,
        });
      }
    }

    this.daySelections.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
    this.monthSelections.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    this.yearSelections.sort((a, b) => b.yearKey.localeCompare(a.yearKey));
    this.typeSelections.sort((a, b) => a.label.localeCompare(b.label));
    this.duplicateSelections.sort((a, b) => {
      const left = new Date(a.file.dateMedia || a.file.dateSync || 0).getTime();
      const right = new Date(
        b.file.dateMedia || b.file.dateSync || 0,
      ).getTime();
      return right - left;
    });

    this.syncSelectionsFromCurrentSelection();
  },
  methods: {
    getType(file) {
      return FileUtils.getType(file);
    },
    getTypeLabel(type) {
      if (type === "image") return "Images";
      if (type === "video") return "Videos";
      return "Other";
    },
    formatDate(date) {
      if (!date) return "Unknown date";
      return new Date(date).toLocaleString();
    },
    async clickedClose() {
      this.$emit("onDone", {});
    },
    doActionSelectAll() {
      this.setSelectedFiles(this.files);
      this.syncSelectionsFromCurrentSelection();
    },
    doActionUnSelectAll() {
      this.setSelectedFiles([]);
      this.syncSelectionsFromCurrentSelection();
    },
    setSelectedFiles(files) {
      const selectedById = new Map();
      for (const file of files) {
        if (!file || !file.id) continue;
        selectedById.set(file.id, file);
      }
      this.selectedFiles.splice(
        0,
        this.selectedFiles.length,
        ...selectedById.values(),
      );
    },
    onDaySelected() {
      const selected = [];
      for (const daySelection of this.daySelections) {
        if (daySelection.selected) {
          selected.push(...daySelection.files);
        }
      }
      this.setSelectedFiles(selected);
      this.syncDateShortcutsFromDays();
    },
    onMonthSelected(monthSelection) {
      for (const daySelection of this.daySelections) {
        if (daySelection.monthKey === monthSelection.monthKey) {
          daySelection.selected = monthSelection.selected;
        }
      }
      this.onDaySelected();
    },
    onYearSelected(yearSelection) {
      for (const daySelection of this.daySelections) {
        if (daySelection.yearKey === yearSelection.yearKey) {
          daySelection.selected = yearSelection.selected;
        }
      }
      this.onDaySelected();
    },
    onTypeSelected() {
      const selected = [];
      for (const typeSelection of this.typeSelections) {
        if (typeSelection.selected) {
          selected.push(...typeSelection.files);
        }
      }
      this.setSelectedFiles(selected);
    },
    onDuplicatesSelected() {
      const selected = this.duplicateSelections
        .filter((selection) => selection.selected)
        .map((selection) => selection.file);
      this.setSelectedFiles(selected);
    },
    syncDateShortcutsFromDays() {
      for (const monthSelection of this.monthSelections) {
        const days = this.daySelections.filter(
          (day) => day.monthKey === monthSelection.monthKey,
        );
        monthSelection.selected =
          days.length > 0 && days.every((day) => day.selected);
      }
      for (const yearSelection of this.yearSelections) {
        const days = this.daySelections.filter(
          (day) => day.yearKey === yearSelection.yearKey,
        );
        yearSelection.selected =
          days.length > 0 && days.every((day) => day.selected);
      }
    },
    syncSelectionsFromCurrentSelection() {
      const selectedIds = new Set(this.selectedFiles.map((file) => file.id));
      for (const daySelection of this.daySelections) {
        daySelection.selected = daySelection.files.every((file) =>
          selectedIds.has(file.id),
        );
      }
      for (const typeSelection of this.typeSelections) {
        typeSelection.selected = typeSelection.files.every((file) =>
          selectedIds.has(file.id),
        );
      }
      for (const duplicateSelection of this.duplicateSelections) {
        duplicateSelection.selected = selectedIds.has(
          duplicateSelection.file.id,
        );
      }
      this.syncDateShortcutsFromDays();
    },
    async doAction() {
      this.$emit("onDone", {});
    },
  },
};
</script>

<style scoped>
.dialog-select {
  width: min(70em, 94vw);
}

.select-mode {
  display: flex;
  gap: 1em;
  flex-wrap: wrap;
  margin-bottom: 0.75em;
}

fieldset {
  margin: 0;
}

.select-shortcuts,
.select-dates {
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 0.4em;
  padding: 0.6em;
  margin-bottom: 0.75em;
}

summary {
  cursor: pointer;
  font-weight: 600;
}

label {
  display: block;
  margin-top: 0.35em;
}

small {
  opacity: 0.7;
}

.helper-text {
  margin: 0;
  opacity: 0.8;
}

.duplicate-row {
  display: flex;
  align-items: center;
  gap: 0.45em;
  white-space: nowrap;
  overflow: hidden;
}

.duplicate-row-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.duplicate-row-meta {
  flex-shrink: 0;
}
</style>
