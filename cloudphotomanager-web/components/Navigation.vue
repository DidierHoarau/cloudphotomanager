<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/"><strong>CloudPhotoManager</strong></NuxtLink>
      </li>
    </ul>
    <ul class="menu-links">
      <li v-if="syncStore.failuresCount > 0 || syncStore.countTotal > 0">
        <NuxtLink
          :to="
            syncStore.failuresCount > 0
              ? '/settings/sync?tab=failures'
              : '/settings/sync'
          "
          class="sync-indicator"
          :class="{
            'sync-indicator-error': syncStore.failuresCount > 0,
            'sync-indicator-blinking': syncStore.countTotal > 0,
          }"
          :title="syncIndicatorTitle"
        >
          <i :class="syncIndicatorIcon"></i>
        </NuxtLink>
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/gallery"
          :class="baseFolder === 'gallery' ? 'active' : 'inactive'"
          ><i class="bi bi-images"></i
        ></NuxtLink>
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/search"
          :class="baseFolder === 'search' ? 'active' : 'inactive'"
          ><i class="bi bi-search"></i
        ></NuxtLink>
      </li>
      <li v-if="authenticationStore.isAdmin">
        <NuxtLink
          to="/settings/accounts"
          :class="baseFolder === 'settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear-fill"></i
        ></NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/users"
          :class="baseFolder === 'users' ? 'active' : 'inactive'"
          ><i class="bi bi-people-fill"></i
        ></NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
const authenticationStore = AuthenticationStore();
const syncStore = SyncStore();

const syncIndicatorIcon = computed(() =>
  syncStore.countTotal > 0
    ? "bi bi-hourglass-split"
    : "bi bi-exclamation-triangle-fill",
);

const syncIndicatorTitle = computed(() => {
  if (syncStore.failuresCount > 0 && syncStore.countTotal > 0) {
    return "Sync in progress with errors — click to review errors";
  }
  if (syncStore.failuresCount > 0) {
    return "Sync operations failed — click to review";
  }
  return "Sync in progress — click to view the queue";
});
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
      sessionRenewTimer: null,
    };
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      SyncStore().monitor();
      // Renew the session cookie periodically so a tab left open without
      // navigation keeps its session (the server re-issues it from the
      // current valid session); navigation itself also renews server-side.
      this.sessionRenewTimer = setInterval(async () => {
        axios
          .post(
            `${(await Config.get()).SERVER_URL}/users/session`,
            {},
            await AuthService.getAuthHeader(),
          )
          .catch(() => {
            // best effort: an expired session is handled on the next request
          });
      }, 24 * 60 * 60 * 1000);
    }
    this.baseFolder = this.$route.fullPath.split("/")[1];
  },
  beforeUnmount() {
    if (this.sessionRenewTimer) {
      clearInterval(this.sessionRenewTimer);
      this.sessionRenewTimer = null;
    }
  },
};
</script>

<style scoped>
nav {
  height: 2rem;
}
.menu-links li {
  padding-right: var(--space-base);
  font-size: var(--font-xl);
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
.sync-indicator {
  font-size: 1em;
}
.sync-indicator-error {
  color: var(--color-danger);
}
.sync-indicator-blinking {
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
