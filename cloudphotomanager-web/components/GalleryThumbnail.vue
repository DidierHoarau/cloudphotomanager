<template>
  <div>
    <div class="gallery-file-image" v-on:click="focusGalleryItem(file)">
      <i
        v-if="getType(file) == 'video'"
        class="bi bi-play-circle gallery-file-video-type-overlay"
      ></i>
      <img
        :src="
          staticUrl +
          '/' +
          file.accountId +
          '/' +
          file.id[0] +
          '/' +
          file.id[1] +
          '/' +
          file.id +
          '/thumbnail.webp'
        "
        onerror="this.onerror=null; this.src='/images/file-sync-in-progress.webp'"
      />
    </div>
    <div v-if="enableSelection" class="gallery-file-selected">
      <input
        v-on:input="onFileSelected(file)"
        type="checkbox"
        :checked="isFileSelected(file)"
      />
    </div>
    <div class="gallery-file-name">
      {{ file.filename }}
    </div>
    <div class="gallery-file-date">{{ displayDate(file.dateMedia) }}</div>
    <div class="gallery-file-size">
      {{ displaySize(file.info.size) }}
    </div>
  </div>
</template>

<script>
import { findIndex } from "lodash";
import { FileUtils } from "~~/services/FileUtils";
import Config from "~~/services/Config.ts";

export default {
  props: {
    file: {
      type: Object,
      required: true,
      default: () => ({}),
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
  },
  data() {
    return {
      staticUrl: "",
    };
  },
  async created() {
    this.staticUrl = (await Config.get()).STATIC_URL;
  },
  methods: {
    onFileSelected(file) {
      this.$emit("onFileSelected", file);
    },
    isFileSelected(file) {
      return findIndex(this.selectedFiles, { id: file.id }) >= 0;
    },
    focusGalleryItem(file) {
      this.$emit("focusGalleryItem", file);
    },
    displayDate(date) {
      if (!date || new Date(date).getTime() === 0) {
        return "";
      }
      return new Date(date).toLocaleString();
    },
    displaySize(size) {
      if (!size) {
        return "";
      }
      try {
        if (size > 1000000000) {
          return (Number(size) / 1000000000).toFixed(1) + " GB";
        }
        if (size > 1000000) {
          return (Number(size) / 1000000).toFixed(1) + " MB";
        }
        if (size > 1000) {
          return (Number(size) / 1000).toFixed(1) + " KB";
        }
        return size + " B";
      } catch (err) {
        return "";
      }
    },
    getType(file) {
      return FileUtils.getType(file);
    },
  },
};
</script>

<style scoped>
.gallery-file-name {
  grid-row: 2;
  grid-column-start: 2;
  grid-column-end: span 2;
  font-size: 0.7em;
  word-break: break-all;
  opacity: 0.8;
}
.gallery-file-image {
  grid-row: 1;
  grid-column-start: 1;
  grid-column-end: span 3;
  word-break: break-all;
  position: relative;
}
.gallery-file-image img {
  width: 100%;
  height: 8em;
  object-fit: cover;
}
.gallery-file-date {
  height: 2em;
  grid-column: 2;
  grid-row: 3;
  font-size: 0.6em;
  word-break: break-all;
  opacity: 0.4;
}
.gallery-file-size {
  height: 2em;
  grid-column: 3;
  grid-row: 3;
  font-size: 0.6em;
  word-break: break-all;
  opacity: 0.4;
}
.gallery-file-selected {
  grid-column: 1;
  grid-row-start: 2;
  grid-row-end: span 2;
  padding-right: 0.3em;
}
.gallery-file-video-type-overlay {
  font-size: 3em;
  position: absolute;
  right: 0.1em;
  bottom: 0em;
  opacity: 0.5;
}
</style>
