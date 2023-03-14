<template>
  <div class="page">
    <p>OneDrive authentication done. Close This window</p>
  </div>
</template>

<script setup></script>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    localStorage.setItem(
      "TMP_AUTH_ONEDRIVE_KEY",
      JSON.stringify({
        date: new Date(),
        type: "oneDrive",
        code: this.$route.query.code,
      })
    );
  },
};
</script>

<style scoped>
.processor-info-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20em, 1fr));
  gap: 10px;
}
.processor-info-layout {
  margin: 1em 1em;
  display: grid;
  grid-template-columns: 3em 1fr;
  grid-template-rows: auto auto;
}
.processor-info-title {
  display: grid;
  grid-row: 1;
  grid-column: 2;
}
.processor-info-icon {
  display: grid;
  grid-column: 1;
  grid-row-start: 1;
  grid-row-end: span 2;
  font-size: 2em;
}
.processor-info-description {
  grid-row: 2;
  grid-column: 2;
}
.processor-info-description span {
  font-size: 0.8em;
  opacity: 0.5;
  word-break: break-all;
}
</style>
