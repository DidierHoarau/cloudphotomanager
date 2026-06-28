<script setup>
import { ThemeService } from "~~/services/ThemeService";

const { isOnline } = useNetworkStatus();

function updateAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

onMounted(() => {
  ThemeService.applyTheme();
  updateAppHeight();
  window.addEventListener("resize", updateAppHeight);
  window.visualViewport?.addEventListener("resize", updateAppHeight);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateAppHeight);
  window.visualViewport?.removeEventListener("resize", updateAppHeight);
});
</script>

<template>
  <div id="page-layout">
    <header>
      <Navigation />
    </header>
    <div
      v-if="!isOnline"
      class="offline-banner"
      role="status"
      aria-live="polite"
    >
      <i class="bi bi-wifi-off"></i> You are offline &mdash; showing cached data
    </div>
    <main>
      <NuxtPage />
    </main>
    <AlertMessages id="page-alert-messages" />
  </div>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  padding: 0.35em 1em;
  font-size: 0.85em;
  font-weight: 600;
  color: #fff;
  background: var(--color-warning, #fd7e14);
  text-align: center;
  pointer-events: none;
}
</style>
