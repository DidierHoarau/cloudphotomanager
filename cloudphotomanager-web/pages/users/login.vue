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

    <article v-if="loginCodeAvailable" class="profile-card">
      <LoginWithCodeCard
        :service="loginCodeService"
        variant="plain"
        :heading-level="3"
        @approved="onLoginCodeApproved"
      />
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
import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";
import {
  loginCodesServiceCreate,
  loginCodesIsAvailable,
} from "~~/utils/loginCodes";

export default {
  components: {
    LoginWithCodeCard,
  },
  data() {
    return {
      user: {},
      loggingIn: false,
      loginCodeService: loginCodesServiceCreate(),
      loginCodeAvailable: false,
    };
  },
  async created() {
    if (!(await UserService.isInitialized())) {
      useRouter().push({ path: "/users/new" });
    }
    if (await AuthService.isAuthenticated()) {
      useRouter().push({ path: "/settings/profile" });
    }
    // Hidden entirely when the feature is off: the routes answer 404.
    this.loginCodeAvailable = await loginCodesIsAvailable(
      this.loginCodeService,
    );
  },
  methods: {
    // The approved poll already set the httpOnly session cookie; never touch
    // the body "token" (it is a non-secret sentinel). Reload the session the
    // same way the password login does.
    async onLoginCodeApproved() {
      if (!(await AuthenticationStore().ensureAuthenticated())) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Sign-in could not be completed",
        });
        return;
      }
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: "User Logged In",
      });
      useRouter().push({ path: "/gallery" });
    },
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
            .then(() => {
              // The server set the httpOnly session cookie on the response.
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
  gap: var(--space-xl);
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
