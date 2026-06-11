<template>
  <div class="page">
    <TabNavigation :tabs="settingsTabs" />
    <div class="actions page-actions">
      <NuxtLink to="/settings/accounts/new"
        ><i class="bi bi-plus-square"></i
      ></NuxtLink>
    </div>
    <table>
      <thead>
        <tr>
          <td>Type</td>
          <td>Name</td>
          <td>Update</td>
          <td>Delete</td>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(account, index) in accountsStore.accounts"
          v-bind:key="index"
        >
          <td>
            <i v-if="account.info.type == 'oneDrive'" class="bi bi-windows"></i>
            <i
              v-else-if="account.info.type == 'awsS3'"
              class="bi bi-amazon"
            ></i>
            <i
              v-else-if="account.info.type == 'localDrive'"
              class="bi bi-device-hdd-fill"
            ></i>
          </td>
          <td>
            {{ account.name }}
          </td>
          <td>
            <NuxtLink :to="`/accounts/${account.id}`"
              ><i class="bi bi-pencil-fill"></i
            ></NuxtLink>
          </td>
          <td>
            <i class="bi bi-trash-fill" v-on:click="clickedDelete(account)"></i>
          </td>
        </tr>
      </tbody>
    </table>
    <DialogConfirm
      v-if="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @onConfirm="onConfirmDialog"
      @onCancel="showConfirmDialog = false"
    />
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
    return {
      settingsTabs: [
        {
          id: "accounts",
          label: "Accounts",
          to: "/settings/accounts",
        },
        {
          id: "sync",
          label: "Sync Queue",
          to: "/settings/sync",
        },
        {
          id: "users",
          label: "Users",
          to: "/settings/users",
        },
      ],
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
    };
  },
  async created() {
    AccountsStore().fetch();
  },
  methods: {
    async clickedDelete(account) {
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = `Delete the account? (Can't be undone!)\nAccount: ${account.name} \n`;
      this.confirmDialogCallback = async () => {
        await axios
          .delete(
            `${(await Config.get()).SERVER_URL}/accounts/${account.id}`,
            await AuthService.getAuthHeader(),
          )
          .then(async (res) => {
            AccountsStore().fetch();
          })
          .catch(handleError);
      };
      this.showConfirmDialog = true;
    },
    onConfirmDialog() {
      this.showConfirmDialog = false;
      if (this.confirmDialogCallback) {
        this.confirmDialogCallback();
      }
    },
  },
};
</script>

<style scoped>
/* Empty - using shared.css .page and .actions styles */
</style>
