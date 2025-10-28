<template>
  <div class="gallery-component">
    <LazyGalleryThumbnail
      class="card gallery-file"
      v-for="file in files"
      :key="file.id"
      :file="file"
      :enableSelection="enableSelection"
      :selectedFiles="selectedFiles"
      @onFileSelected="onFileSelected"
      @focusGalleryItem="focusGalleryItem"
    />
  </div>
</template>

<script>
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
  },
  methods: {
    onFileSelected(file) {
      this.$emit("onFileSelected", file);
    },
    focusGalleryItem(file) {
      this.$emit("focusGalleryItem", file);
    },
  },
};
</script>

<style scoped>
.gallery-component {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: 1em;
}
.gallery-file {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto auto;
  height: 11em;
}
</style>
