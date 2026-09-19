<template>
  <div ref="root" class="gallery-component">
    <div
      aria-hidden="true"
      class="gallery-window-spacer"
      :style="{ height: topSpacerHeight + 'px' }"
    ></div>
    <div ref="grid" class="gallery-grid">
      <LazyGalleryThumbnail
        class="card gallery-file"
        v-for="file in visibleFiles"
        :key="file.id"
        :file="file"
        :enableSelection="enableSelection"
        :selectedFiles="selectedFiles"
        :duplicateCount="duplicateCounts[file.id] || 0"
        @onFileSelected="onFileSelected"
        @focusGalleryItem="focusGalleryItem"
      />
    </div>
    <div
      aria-hidden="true"
      class="gallery-window-spacer"
      :style="{ height: bottomSpacerHeight + 'px' }"
    ></div>
  </div>
</template>

<script>
// Must match the .gallery-grid / .gallery-file CSS below:
const CELL_MIN_WIDTH_EM = 10; // grid-template-columns minmax(10em, 1fr)
const CELL_HEIGHT_EM = 11; // .gallery-file height
const BUFFER_VIEWPORTS = 2; // rows rendered above/below the viewport

export default {
  props: {
    files: {
      type: Array,
      required: false,
      default: () => [],
    },
    selectedFiles: {
      type: Array,
      required: false,
      default: () => [],
    },
    enableSelection: {
      type: Boolean,
      required: false,
      default: () => true,
    },
    duplicateCounts: {
      type: Object,
      required: false,
      default: () => ({}),
    },
  },
  data() {
    return {
      visibleFiles: [],
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  },
  watch: {
    files: {
      immediate: true,
      handler() {
        this.scheduleWindowUpdate();
      },
    },
  },
  mounted() {
    this._scrollParent = this.findScrollParent(this.$el);
    this._onScroll = () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = null;
        this.updateWindow();
      });
    };
    this._scrollParent.addEventListener("scroll", this._onScroll, {
      passive: true,
    });
    window.addEventListener("resize", this._onScroll);
    this._resizeObserver = new ResizeObserver(this._onScroll);
    this._resizeObserver.observe(this.$el);
    if (this._scrollParent instanceof Element) {
      this._resizeObserver.observe(this._scrollParent);
    }
    this.scheduleWindowUpdate();
  },
  beforeUnmount() {
    this._scrollParent.removeEventListener("scroll", this._onScroll);
    window.removeEventListener("resize", this._onScroll);
    this._resizeObserver.disconnect();
    if (this._scrollRaf) {
      cancelAnimationFrame(this._scrollRaf);
      this._scrollRaf = null;
    }
  },
  methods: {
    onFileSelected(file) {
      this.$emit("onFileSelected", file);
    },
    focusGalleryItem(file) {
      this.$emit("focusGalleryItem", file);
    },
    findScrollParent(el) {
      let node = el.parentElement;
      while (node) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (
          overflowY === "auto" ||
          overflowY === "scroll" ||
          overflowY === "overlay"
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return window;
    },
    getViewportRect() {
      if (this._scrollParent === window) {
        return { top: 0, bottom: window.innerHeight };
      }
      const rect = this._scrollParent.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    },
    scheduleWindowUpdate() {
      this.$nextTick(() => {
        this.updateWindow();
      });
    },
    updateWindow() {
      const root = this.$el;
      const grid = this.$refs.grid;
      if (!root || !grid) return;
      const files = this.files;
      const total = files.length;
      if (total === 0) {
        this._lastWindow = null;
        if (
          this.visibleFiles.length ||
          this.topSpacerHeight ||
          this.bottomSpacerHeight
        ) {
          this.visibleFiles = [];
          this.topSpacerHeight = 0;
          this.bottomSpacerHeight = 0;
        }
        return;
      }
      const rootWidth = root.clientWidth;
      if (rootWidth <= 0) return;
      const gridStyle = window.getComputedStyle(grid);
      const emPx = parseFloat(gridStyle.fontSize) || 16;
      const gapPx =
        parseFloat(gridStyle.rowGap) ||
        parseFloat(gridStyle.columnGap) ||
        emPx;
      const cellHeight = CELL_HEIGHT_EM * emPx;
      const rowPitch = cellHeight + gapPx;
      const columns = Math.max(
        1,
        Math.floor(
          (rootWidth + gapPx) / (CELL_MIN_WIDTH_EM * emPx + gapPx),
        ),
      );
      const totalRows = Math.ceil(total / columns);

      const viewport = this.getViewportRect();
      const rootRect = root.getBoundingClientRect();
      const bufferRows = Math.ceil(
        ((viewport.bottom - viewport.top) * BUFFER_VIEWPORTS) / rowPitch,
      );
      let firstRow =
        Math.floor(Math.max(0, viewport.top - rootRect.top) / rowPitch) -
        bufferRows;
      let lastRow =
        Math.ceil(Math.max(0, viewport.bottom - rootRect.top) / rowPitch) +
        bufferRows;
      firstRow = Math.max(0, Math.min(firstRow, totalRows - 1));
      lastRow = Math.max(firstRow, Math.min(lastRow, totalRows - 1));

      if (
        this._lastWindow &&
        this._lastWindow.filesRef === files &&
        this._lastWindow.firstRow === firstRow &&
        this._lastWindow.lastRow === lastRow &&
        this._lastWindow.columns === columns
      ) {
        return;
      }
      this._lastWindow = { filesRef: files, firstRow, lastRow, columns };

      this.visibleFiles = files.slice(
        firstRow * columns,
        Math.min(total, (lastRow + 1) * columns),
      );
      this.topSpacerHeight = firstRow * rowPitch;
      this.bottomSpacerHeight = (totalRows - lastRow - 1) * rowPitch;
    },
  },
};
</script>

<style scoped>
.gallery-component {
  width: 100%;
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: var(--space-base);
}
.gallery-file {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto auto;
  height: 11em;
}
.gallery-window-spacer {
  width: 100%;
}
</style>
