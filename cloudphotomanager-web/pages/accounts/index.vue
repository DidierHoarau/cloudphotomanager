<template>
  <div class="page">
    <p>Accounts</p>
    <div class="actions page-actions">
      <NuxtLink to="/accounts/new"><i class="bi bi-plus-square"></i></NuxtLink>
    </div>
    <table>
      <thead>
        <tr>
          <td>Type</td>
          <td>Name</td>
          <td>Delete</td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(account, index) in accountsStore.accounts" v-bind:key="index">
          <td>
            <i v-if="account.info.type == 'oneDrive'" class="bi bi-windows"></i>
            <i v-else-if="account.info.type == 'awsS3'" class="bi bi-amazon"></i>
            <i v-else-if="account.info.type == 'localDrive'" class="bi bi-device-hdd-fill"></i>
          </td>
          <td>
            {{ account.name }}
          </td>
          <td>
            <i class="bi bi-trash-fill" v-on:click="clickedDelete(account)"></i>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
const accountsStore = AccountsStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {};
  },
  async created() {
    AccountsStore().fetch();
  },
  methods: {
    async clickedDelete(account) {
      if (confirm(`Delete the account? (Can't be undone!)\nAccount: ${account.name} \n`) == true) {
        await axios
          .delete(`${(await Config.get()).SERVER_URL}/accounts/${account.id}`, await AuthService.getAuthHeader())
          .then(async (res) => {
            AccountsStore().fetch();
          })
          .catch(handleError);
      }
    },
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
