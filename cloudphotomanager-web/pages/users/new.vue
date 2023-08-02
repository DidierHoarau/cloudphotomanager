<template>
  <div class="page">
    <h1>New User</h1>
    <label>Name</label>
    <input id="username" v-model="user.name" type="text" />
    <label>Password</label>
    <input id="passwrd" v-model="user.password" type="password" />
    <button v-on:click="saveNew()">Create</button>
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
    };
  },
  async created() {
    if ((await UserService.isInitialized()) && !(await AuthenticationStore()).isAdmin) {
      useRouter().push({ path: "/users/" });
    }
    AuthenticationStore().isAuthenticated = await AuthService.isAuthenticated();
  },
  methods: {
    async saveNew() {
      const isInitialized = await UserService.isInitialized();
      if (this.user.name && this.user.password) {
        await axios
          .post(`${(await Config.get()).SERVER_URL}/users`, this.user, await AuthService.getAuthHeader())
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "User created",
            });
            if (isInitialized) {
              useRouter().go(-1);
            } else {
              this.login();
            }
          })
          .catch(handleError);
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
