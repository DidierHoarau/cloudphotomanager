<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/"><strong>CloudPhotoManager</strong></NuxtLink>
      </li>
    </ul>
    <ul class="menu-links">
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink to="/gallery" :class="baseFolder === 'gallery' ? 'active' : 'inactive'"
          ><i class="bi bi-images"></i
        ></NuxtLink>
      </li>
      <li v-if="authenticationStore.isAdmin">
        <NuxtLink to="/analysis" :class="baseFolder === 'analysis' ? 'active' : 'inactive'"
          ><i class="bi bi-clipboard-data-fill"></i
        ></NuxtLink>
      </li>
      <li v-if="authenticationStore.isAdmin">
        <NuxtLink to="/accounts" :class="baseFolder === 'accounts' ? 'active' : 'inactive'"
          ><i class="bi bi-clouds-fill"></i
        ></NuxtLink>
      </li>
      <li>
        <NuxtLink to="/users" :class="baseFolder === 'users' ? 'active' : 'inactive'"
          ><i class="bi bi-people-fill"></i
        ></NuxtLink>
      </li>
    </ul>
    <dialog v-if="syncStore.countBlocking > 0" open>
      <i class="bi bi-hourglass-split"></i>&nbsp;&nbsp; Operations in Progress, please wait
    </dialog>
  </nav>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
const authenticationStore = AuthenticationStore();
const syncStore = SyncStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  watch: {
    $route(to, from) {
      this.baseFolder = to.fullPath.split("/")[1];
    },
  },
  data() {
    return {
      baseFolder: "",
    };
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      SyncStore().fetch();
      setTimeout(async () => {
        // Renew session tocken
        axios
          .post(`${(await Config.get()).SERVER_URL}/users/session`, {}, await AuthService.getAuthHeader())
          .then((res) => {
            AuthService.saveToken(res.data.token);
          });
      }, 10000);
    }
    this.baseFolder = this.$route.fullPath.split("/")[1];
  },
};
</script>

<style scoped>
.menu-links li {
  padding-right: 1em;
  font-size: 1.2em;
}
.inactive {
  opacity: 0.4;
}
.sync-count kbd {
  font-size: 50%;
  text-align: center;
  padding: 0.3em 0.6em;
  opacity: 0.3;
}
</style>
