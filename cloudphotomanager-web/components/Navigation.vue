<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/"><strong>CloudPhotoManager</strong></NuxtLink>
      </li>
    </ul>
    <ul class="menu-links">
      <li
        v-if="syncStore.failuresCount > 0 || syncStore.countTotal > 0"
        class="sync-center-root"
      >
        <button
          type="button"
          class="sync-indicator"
          :class="{
            'sync-indicator-error': syncStore.failuresCount > 0,
            'sync-indicator-blinking': syncStore.countTotal > 0,
          }"
          :title="syncIndicatorTitle"
          :aria-expanded="syncCenterOpen ? 'true' : 'false'"
          @click="toggleSyncCenter"
        >
          <i :class="syncIndicatorIcon"></i>
          <kbd v-if="syncStore.failuresCount > 0" class="sync-count-badge">{{
            syncStore.failuresCount
          }}</kbd>
        </button>
        <SyncNotificationCenter
          v-if="syncCenterOpen"
          @close="syncCenterOpen = false"
        />
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
          to="/timeline"
          :class="baseFolder === 'timeline' ? 'active' : 'inactive'"
          ><i class="bi bi-clock-history"></i
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
          to="/trash"
          :class="baseFolder === 'trash' ? 'active' : 'inactive'"
          ><i class="bi bi-trash"></i
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

const syncCenterOpen = ref(false);
function toggleSyncCenter() {
  syncCenterOpen.value = !syncCenterOpen.value;
}

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
  min-height: 2rem;
  height: auto;
  flex-wrap: wrap;
  row-gap: var(--space-xs);
  column-gap: var(--space-sm);
}
.menu-links {
  flex-wrap: wrap;
  row-gap: var(--space-xs);
  min-width: 0;
}
.menu-links li {
  padding-right: var(--space-base);
  font-size: var(--font-xl);
}
@media (max-width: 600px) {
  .menu-links li {
    font-size: var(--font-lg);
    padding-right: var(--space-sm);
  }
  nav ul:last-of-type {
    margin-left: auto;
  }
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
.sync-center-root {
  position: relative;
}
button.sync-indicator {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: inherit;
  line-height: 1;
  display: inline-flex;
  align-items: flex-start;
}
.sync-count-badge {
  font-size: 0.55em;
  margin-left: 0.25em;
  background: var(--color-danger);
  color: var(--color-text-inverse);
  border-radius: var(--radius-full);
  padding: 0 0.45em;
  line-height: 1.5;
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
