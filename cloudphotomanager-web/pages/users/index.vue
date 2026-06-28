<template>
  <div class="user-page">
    <!-- AUTHENTICATED: Profile Section -->
    <div class="profile-content">
      <!-- Account Info -->
      <article>
        <h3>
          <i class="bi bi-person-circle"></i>
          Account
        </h3>
        <p>
          Logged in as <strong>{{ authenticationStore.userName }}</strong>
          <span v-if="authenticationStore.isAdmin" class="badge badge-admin"
            >Admin</span
          >
          <span v-else class="badge badge-user">User</span>
        </p>
        <div class="article-actions">
          <button class="secondary outline" @click="logout()">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
        </div>
      </article>

      <!-- Change Password -->
      <article>
        <h3>
          <i class="bi bi-key"></i>
          Change Password
        </h3>
        <p>Update your account password.</p>
        <div v-if="!isChangePasswordStarted">
          <button @click="changePasswordStart(true)">
            <i class="bi bi-pencil"></i> Change Password
          </button>
        </div>
        <div v-else>
          <label>
            Current Password
            <input
              type="password"
              v-model="user.passwordOld"
              placeholder="Enter current password"
            />
          </label>
          <label>
            New Password
            <input
              type="password"
              v-model="user.password"
              placeholder="Enter new password"
              @keyup.enter="changePassword()"
            />
          </label>
          <div class="article-actions">
            <button class="secondary" @click="changePasswordStart(false)">
              Cancel
            </button>
            <button :disabled="savingPassword" @click="changePassword()">
              <i class="bi bi-check-lg"></i>
              {{ savingPassword ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
      </article>

      <!-- Theme Preference -->
      <article>
        <h3>
          <i class="bi bi-palette"></i>
          Theme
        </h3>
        <p>Switch between dark and light mode.</p>
        <div class="article-actions">
          <button class="secondary outline" @click="toggleTheme">
            <i :class="isDark ? 'bi bi-sun-fill' : 'bi bi-moon-fill'"></i>
            {{ isDark ? "Switch to Light Mode" : "Switch to Dark Mode" }}
          </button>
        </div>
      </article>
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
import { UserService } from "~~/services/UserService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { ThemeService } from "~~/services/ThemeService";

export default {
  data() {
    return {
      user: {},
      isChangePasswordStarted: false,
      savingPassword: false,
      isDark: false,
    };
  },
  async created() {
    this.isDark = ThemeService.isDark();
    if (!(await UserService.isInitialized())) {
      useRouter().push({ path: "/users/new" });
    }
    if (!(await AuthService.isAuthenticated())) {
      useRouter().push({ path: "/users/login" });
    }
  },
  methods: {
    toggleTheme() {
      this.isDark = ThemeService.toggleTheme();
    },
    async changePassword() {
      if (this.user.password && this.user.passwordOld) {
        this.savingPassword = true;
        try {
          await axios.put(
            `${(await Config.get()).SERVER_URL}/users/password`,
            this.user,
            await AuthService.getAuthHeader(),
          );
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Password Changed",
          });
          this.isChangePasswordStarted = false;
          this.user = {};
        } catch (err) {
          handleError(err);
        } finally {
          this.savingPassword = false;
        }
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Password missing",
        });
      }
    },
    async logout() {
      AuthService.removeToken();
      AuthenticationStore().isAuthenticated = false;
      useRouter().push({ path: "/users/login" });
    },
    changePasswordStart(enable) {
      this.isChangePasswordStarted = enable;
      this.user = {};
    },
  },
};
</script>

<style scoped>
.user-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: var(--space-base);
  width: 100%;
}

.profile-content {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.badge {
  display: inline-block;
  font-size: var(--font-sm);
  padding: 0.1em 0.5em;
  border-radius: var(--radius-sm);
  margin-left: var(--space-sm);
  vertical-align: middle;
  font-weight: 600;
}

.badge-admin {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}

.badge-user {
  color: var(--color-primary);
  background: var(--color-primary-focus-ring);
}

.article-actions {
  margin-top: var(--space-base);
  display: flex;
  gap: var(--space-sm);
}
</style>
