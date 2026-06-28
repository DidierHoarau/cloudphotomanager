<template>
  <div class="user-page">
    <article class="profile-card">
      <h3>
        <i
          class="bi"
          :class="isInitialized ? 'bi-person-plus' : 'bi-person-plus'"
        ></i>
        {{ isInitialized ? "New User" : "Create Admin Account" }}
      </h3>
      <p>
        {{
          isInitialized
            ? "Create a new user account."
            : "Set up the initial administrator account."
        }}
      </p>
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
      <div class="article-actions">
        <button :disabled="saving" @click="saveNew()">
          <i class="bi bi-check-lg"></i>
          {{ saving ? "Creating…" : "Create" }}
        </button>
      </div>
    </article>
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
import { UserService } from "~~/services/UserService";

export default {
  data() {
    return {
      user: {},
      saving: false,
      isInitialized: true,
    };
  },
  async created() {
    this.isInitialized = await UserService.isInitialized();
    if (this.isInitialized && !(await AuthenticationStore()).isAdmin) {
      useRouter().push({ path: "/users/" });
    }
    AuthenticationStore().isAuthenticated = await AuthService.isAuthenticated();
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
              if (this.isInitialized) {
                useRouter().go(-1);
              } else {
                this.login();
              }
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
    async login() {
      if (this.user.name && this.user.password) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/users/session`,
            this.user,
            await AuthService.getAuthHeader(),
          )
          .then((res) => {
            AuthService.saveToken(res.data.token);
            AuthenticationStore().isAuthenticated = true;
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "User Logged In",
            });
            useRouter().push({ path: "/gallery" });
          })
          .catch(handleError);
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
.user-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: var(--space-2xl);
  width: 100%;
}

.profile-card {
  max-width: 480px;
  width: 100%;
}

.article-actions {
  margin-top: var(--space-base);
  display: flex;
  gap: var(--space-sm);
}
</style>
