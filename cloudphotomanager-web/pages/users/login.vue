<template>
  <div class="user-page">
    <article class="profile-card">
      <h3>
        <i class="bi bi-box-arrow-in-right"></i>
        Sign In
      </h3>
      <p>Enter your credentials to access the gallery.</p>
      <label>
        Username
        <input
          type="text"
          v-model="user.name"
          placeholder="Enter username"
          @keyup.enter="login()"
        />
      </label>
      <label>
        Password
        <input
          type="password"
          v-model="user.password"
          placeholder="Enter password"
          @keyup.enter="login()"
        />
      </label>
      <div class="article-actions">
        <button :disabled="loggingIn" @click="login()">
          <i class="bi bi-box-arrow-in-right"></i>
          {{ loggingIn ? "Signing in…" : "Sign In" }}
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
      loggingIn: false,
    };
  },
  async created() {
    if (!(await UserService.isInitialized())) {
      useRouter().push({ path: "/users/new" });
    }
    if (await AuthService.isAuthenticated()) {
      useRouter().push({ path: "/users" });
    }
  },
  methods: {
    async login() {
      if (this.user.name && this.user.password) {
        this.loggingIn = true;
        try {
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
        } finally {
          this.loggingIn = false;
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
