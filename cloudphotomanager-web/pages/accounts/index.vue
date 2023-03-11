<template>
  <div class="page">
    <p>Accounts</p>
    <div class="actions page-actions">
      <NuxtLink to="/accounts/new"><i class="bi bi-plus-square"></i></NuxtLink>
    </div>
    <div v-for="(account, index) in accountsStore.accounts" v-bind:key="index">{{ account }}</div>
  </div>
</template>

<script setup>
const accountsStore = AccountsStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  data() {
    return {};
  },
  async created() {
    AccountsStore().fetch();
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
