<template>
  <div class="page">
    <h1>Users</h1>
    <table>
      <thead>
        <tr>
          <td>Name</td>
          <td><i class="bi bi-shield-check"></i> Permissions</td>
          <td><i class="bi bi-trash-fill"></i> Delete</td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" v-bind:key="user.id">
          <td>{{ user.name }}</td>
          <td>
            <div v-if="user.permissions && user.permissions.isAdmin">Admin</div>
            <div v-else-if="user.permissions">
              <div v-for="folder in user.permissions.folders" v-bind:key="folder.id">
                <i v-on:click="clickedPermissionsUserRemoveFolder(user, folder)" class="bi bi-trash-fill"></i
                >&nbsp;&nbsp;({{ folder.accountName }})&nbsp;{{ folder.folderpath }}&nbsp;({{ folder.scope_tag }})
              </div>
              <div v-on:click="clickedPermissionsUserAddFolder(user)"><i class="bi bi-folder-plus"></i> Add Folder</div>
            </div>
          </td>
          <td>
            <i
              v-if="user.permissions && !user.permissions.isAdmin"
              class="bi bi-trash-fill"
              v-on:click="clickedDelete(user)"
            ></i>
            <i v-else-if="user.permissions" class="bi bi-slash-circle"></i>
          </td>
        </tr>
      </tbody>
    </table>
    <NuxtLink to="/users/new"><button>New User</button></NuxtLink>
    <DialogFolderPermission
      v-if="activeOperation == 'userIdAddPermission'"
      :userId="targetUserId"
      @onDone="onOperationDone"
    />
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import * as _ from "lodash";

export default {
  data() {
    return {
      users: {},
      activeOperation: "",
      isChangePasswordStarted: false,
      targetUserId: "",
    };
  },
  async created() {
    await AccountsStore().fetch();
    SyncStore().fetch();
    FoldersStore().fetch();
    await AuthenticationStore().ensureAuthenticated();
    if (!(await AuthenticationStore()).userInfo.permissions.isAdmin) {
      useRouter().push({ path: "/users" });
    }
    this.fetch();
  },
  methods: {
    async fetch() {
      await axios
        .get(`${(await Config.get()).SERVER_URL}/users/`, await AuthService.getAuthHeader())
        .then(async (res) => {
          this.users = res.data.users;
          for (const user of this.users) {
            await axios
              .get(`${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`, await AuthService.getAuthHeader())
              .then(async (res) => {
                user.permissions = res.data.info;
                for (const folder of user.permissions.folders || []) {
                  const folderKnown = _.find(FoldersStore().folders, { id: folder.folderId });
                  const accountKnown = _.find(AccountsStore().accounts, { id: folderKnown.accountId });
                  folder.scope_tag = "RO";
                  if (folder.scope === "ro_recursive") {
                    folder.scope_tag = "RO Recursive";
                  }
                  folder.accountName = accountKnown.name || "Unknown Folder";
                  folder.folderpath = folderKnown.folderpath || "Unknown Folder";
                }
              })
              .catch(handleError);
          }
        })
        .catch(handleError);
    },
    async clickedDelete(user) {
      if (confirm(`Delete the user? (Can't be undone!)\nUser: ${user.name} \n`) == true) {
        await axios
          .delete(`${(await Config.get()).SERVER_URL}/users/${user.id}`, await AuthService.getAuthHeader())
          .then(async (res) => {
            await this.fetch();
          })
          .catch(handleError);
      }
    },
    async clickedPermissionsUserRemoveFolder(user, folder) {
      await axios
        .get(`${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`, await AuthService.getAuthHeader())
        .then(async (res) => {
          const permissions = res.data;
          const folderToRemove = _.findIndex(permissions.info.folders, { folderId: folder.folderId });
          if (folderToRemove >= 0) {
            permissions.info.folders.splice(folderToRemove, 1);
            await axios.put(
              `${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`,
              permissions,
              await AuthService.getAuthHeader()
            );
          }
          this.fetch();
        })
        .catch(handleError);
    },
    async clickedPermissionsUserAddFolder(user) {
      this.activeOperation = "userIdAddPermission";
      this.targetUserId = user.id;
    },
    onOperationDone(result) {
      this.targetUserId = "";
      this.activeOperation = "";
      this.fetch();
    },
  },
};
</script>

<style scoped></style>
