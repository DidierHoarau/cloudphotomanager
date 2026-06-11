<template>
  <div class="page">
    <TabNavigation :tabs="settingsTabs" />
    <label>
      Username
      <input
        type="text"
        v-model="user.name"
        placeholder="Enter username"
        @keyup.enter="saveNew()"
      />
    </label>
    <label>
      Password
      <input
        type="password"
        v-model="user.password"
        placeholder="Enter password"
        @keyup.enter="saveNew()"
      />
    </label>
    <div class="page-actions">
      <button :disabled="saving" @click="saveNew()">
        <i class="bi bi-check-lg"></i>
        {{ saving ? "Creating\u2026" : "Create" }}
      </button>
    </div>
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
      user: {},
      saving: false,
    };
  },
  async created() {
    await AuthenticationStore().ensureAuthenticated();
    if (!(await AuthenticationStore()).isAdmin) {
      useRouter().push({ path: "/settings/users" });
    }
  },
  methods: {
    async saveNew() {
      if (this.user.name && this.user.password) {
        this.saving = true;
        try {
          await axios
            .post(
              `${(await Config.get()).SERVER_URL}/users`,
              this.user,
              await AuthService.getAuthHeader(),
            )
            .then((res) => {
              EventBus.emit(EventTypes.ALERT_MESSAGE, {
                type: "info",
                text: "User created",
              });
              useRouter().push({ path: "/settings/users" });
            })
            .catch(handleError);
        } finally {
          this.saving = false;
        }
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Username or password missing",
        });
      }
    },
  },
};
</script>

<style scoped>
label {
  display: block;
  margin-top: var(--space-base);
}

.page-actions {
  margin-top: var(--space-base);
  display: flex;
  gap: var(--space-sm);
}
</style>
