<template>
  <div class="page">
    <h1>Profile</h1>
    <button v-on:click="logout()">Logout</button>
    <button v-if="!isChangePasswordStarted" v-on:click="changePasswordStart(true)">Change Password</button>
    <NuxtLink
      v-if="authenticationStore.userInfo.permissions && authenticationStore.userInfo.permissions.isAdmin"
      to="/users/management"
      ><button>Users</button></NuxtLink
    >
    <article v-else>
      <h1>Change Password</h1>
      <label>Old Password</label>
      <input id="password" v-model="user.passwordOld" type="password" />
      <label>New Password</label>
      <input id="passwordOld" v-model="user.password" type="password" />
      <button v-on:click="changePassword()">Change</button>
      <button v-on:click="changePasswordStart(false)">Cancel</button>
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
      isChangePasswordStarted: false,
    };
  },
  async created() {
    if (!(await UserService.isInitialized())) {
      useRouter().push({ path: "/users/new" });
    }
    if (!(await AuthService.isAuthenticated())) {
      useRouter().push({ path: "/users/login" });
    }
  },
  methods: {
    async login() {
      if (this.user.name && this.user.password) {
        await axios
          .post(`${(await Config.get()).SERVER_URL}/users/session`, this.user, await AuthService.getAuthHeader())
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
    async changePassword() {
      if (this.user.password && this.user.passwordOld) {
        await axios
          .put(`${(await Config.get()).SERVER_URL}/users/password`, this.user, await AuthService.getAuthHeader())
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "Password Changed",
            });
            this.isChangePasswordStarted = false;
            this.user = {};
          })
          .catch(handleError);
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

<style scoped></style>
