import { ref, onMounted, onUnmounted } from "vue";

const isOnline = ref(
  typeof navigator !== "undefined" ? navigator.onLine : true,
);

let listenerCount = 0;
function onOnline() {
  isOnline.value = true;
}
function onOffline() {
  isOnline.value = false;
}

/**
 * Returns a reactive `isOnline` boolean that tracks the browser's network
 * connectivity. Safe to call from any component; listeners are shared.
 */
export function useNetworkStatus() {
  onMounted(() => {
    if (listenerCount === 0) {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    }
    listenerCount++;
  });

  onUnmounted(() => {
    listenerCount--;
    if (listenerCount === 0) {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    }
  });

  return { isOnline };
}
