<template>
  <div class="page">
    <h1>Login</h1>
    <label>Name</label>
    <input id="username" v-model="user.name" type="text" />
    <label>Password</label>
    <input id="passwrd" v-model="user.password" type="password" />
    <button v-on:click="login()">Login</button>
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
    if (await AuthService.isAuthenticated()) {
      useRouter().push({ path: "/users" });
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
  },
};
</script>

<style scoped></style>
