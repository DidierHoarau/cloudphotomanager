<template>
  <div class="page">
    <TabNavigation :tabs="settingsTabs" />
    <div class="actions page-actions">
      <NuxtLink to="/settings/users/new"
        ><i class="bi bi-person-plus"></i
      ></NuxtLink>
    </div>
    <div v-if="users.length === 0" class="empty-state">
      <i class="bi bi-inbox"></i>
      <p>No users found</p>
    </div>
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th><i class="bi bi-shield-check"></i> Permissions</th>
            <th class="col-actions"><i class="bi bi-trash-fill"></i> Delete</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" v-bind:key="user.id">
            <td class="cell-name">
              <span class="user-name">{{ user.name }}</span>
              <span
                v-if="user.permissions && user.permissions.isAdmin"
                class="badge badge-admin"
                >Admin</span
              >
              <span v-else class="badge badge-user">User</span>
            </td>
            <td>
              <div v-if="user.permissions && !user.permissions.isAdmin">
                <div
                  v-for="folder in user.permissions.folders"
                  v-bind:key="folder.id"
                  class="folder-permission-row"
                >
                  <span class="folder-permission-tag">
                    <span class="folder-account"
                      >({{ folder.accountName }})</span
                    >
                    {{ folder.folderpath }}
                    <kbd>{{ folder.scope_tag }}</kbd>
                  </span>
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Remove folder permission"
                    @click="clickedPermissionsUserRemoveFolder(user, folder)"
                  >
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <button
                  class="secondary outline small-btn"
                  @click="clickedPermissionsUserAddFolder(user)"
                >
                  <i class="bi bi-folder-plus"></i> Add Folder
                </button>
              </div>
              <span v-else-if="!user.permissions" class="text-muted"
                >Loading…</span
              >
            </td>
            <td class="col-actions">
              <button
                v-if="user.permissions && !user.permissions.isAdmin"
                class="icon-btn icon-btn-danger"
                title="Delete user"
                @click="clickedDelete(user)"
              >
                <i class="bi bi-trash-fill"></i>
              </button>
              <span v-else-if="user.permissions" title="Cannot delete admin">
                <i class="bi bi-slash-circle text-muted"></i>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <DialogFolderPermission
      v-if="activeOperation == 'userIdAddPermission'"
      :userId="targetUserId"
      @onDone="onOperationDone"
    />
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
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { find, findIndex } from "lodash";

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
      users: [],
      activeOperation: "",
      targetUserId: "",
      showConfirmDialog: false,
      confirmDialogTitle: "",
      confirmDialogMessage: "",
      confirmDialogCallback: null,
    };
  },
  async created() {
    await AccountsStore().fetch();
    FoldersStore().fetch();
    await AuthenticationStore().ensureAuthenticated();
    if (!(await AuthenticationStore()).isAdmin) {
      useRouter().push({ path: "/users" });
    }
    this.fetch();
  },
  methods: {
    async fetch() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/users/`,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.users = res.data.users;
          for (const user of this.users) {
            await axios
              .get(
                `${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`,
                await AuthService.getAuthHeader(),
              )
              .then(async (res) => {
                user.permissions = res.data.info;
                for (const folder of user.permissions.folders || []) {
                  const folderKnown = find(FoldersStore().folders, {
                    id: folder.folderId,
                  });
                  const accountKnown = find(AccountsStore().accounts, {
                    id: folderKnown.accountId,
                  });
                  folder.scope_tag = "RO";
                  if (folder.scope === "ro_recursive") {
                    folder.scope_tag = "RO Recursive";
                  }
                  folder.accountName = accountKnown.name || "Unknown Folder";
                  folder.folderpath =
                    folderKnown.folderpath || "Unknown Folder";
                }
              })
              .catch(handleError);
          }
        })
        .catch(handleError);
    },
    async clickedDelete(user) {
      this.confirmDialogTitle = "Confirm Delete";
      this.confirmDialogMessage = `Delete the user? (Can't be undone!)\nUser: ${user.name} \n`;
      this.confirmDialogCallback = async () => {
        await axios
          .delete(
            `${(await Config.get()).SERVER_URL}/users/${user.id}`,
            await AuthService.getAuthHeader(),
          )
          .then(async (res) => {
            await this.fetch();
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
    async clickedPermissionsUserRemoveFolder(user, folder) {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          const permissions = res.data;
          const folderToRemove = findIndex(permissions.info.folders, {
            folderId: folder.folderId,
          });
          if (folderToRemove >= 0) {
            permissions.info.folders.splice(folderToRemove, 1);
            await axios.put(
              `${(await Config.get()).SERVER_URL}/users/${user.id}/permissions`,
              permissions,
              await AuthService.getAuthHeader(),
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

<style scoped>
.table-wrapper {
  overflow-x: auto;
  margin-top: var(--space-sm);
}

table {
  width: 100%;
}

th {
  font-weight: 600;
  white-space: nowrap;
}

.col-actions {
  width: 5em;
  text-align: center;
}

.cell-name {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.user-name {
  font-weight: 500;
}

.badge {
  display: inline-block;
  font-size: var(--font-xs);
  padding: 0.1em 0.5em;
  border-radius: var(--radius-sm);
  font-weight: 600;
  white-space: nowrap;
}

.badge-admin {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}

.badge-user {
  color: var(--color-primary);
  background: var(--color-primary-focus-ring);
}

.folder-permission-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.folder-permission-tag {
  font-size: 0.85em;
  word-break: break-all;
}

.folder-permission-tag kbd {
  font-size: 0.75em;
  margin-left: var(--space-xs);
}

.folder-account {
  opacity: 0.7;
}

.text-muted {
  opacity: 0.5;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: var(--space-xs);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.icon-btn-danger {
  color: var(--color-danger);
}

.icon-btn-danger:hover {
  background: var(--color-danger-bg);
}

.small-btn {
  font-size: var(--font-base);
  padding: var(--space-xs) var(--space-md);
}

.empty-state {
  text-align: center;
  padding: var(--space-3xl);
  opacity: 0.5;
}

.empty-state i {
  font-size: 3em;
  margin-bottom: var(--space-sm);
}
</style>
