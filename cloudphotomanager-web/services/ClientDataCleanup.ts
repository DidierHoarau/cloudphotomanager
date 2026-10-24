import { localCache } from "./LocalCache";

/**
 * Client-side data lifecycle: scopes caches per user and clears them on
 * logout / user switch so a previous user's data is never readable by the
 * next user of a shared browser.
 */

/** Service-worker runtime data caches (must match nuxt.config.ts). */
export const SW_DATA_CACHE_NAMES = {
  folders: "api-folders",
  folderCounts: "api-folder-counts",
  thumbnails: "thumbnails",
  previews: "preview-images",
} as const;

const CLIENT_CACHE_USER_KEY = "clientCacheUserId";
// One-time migration: the first boot after this flag's introduction deletes
// all SW data caches once, dropping entries cached under the pre-signed-URL
// media scheme.
const SW_DATA_CACHES_V2_KEY = "swDataCachesV2";

/** Delete the service-worker runtime data caches (not the app shell). */
export async function clearSwDataCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(
    Object.values(SW_DATA_CACHE_NAMES).map(async (name) => {
      try {
        await caches.delete(name);
      } catch {
        // best effort — a failed cache deletion must never break the app
      }
    }),
  );
}

/**
 * Bind the client caches to a user: scope IndexedDB, drop other users'
 * entries and legacy unscoped keys, sweep for bounded growth, and clear the
 * service-worker data caches on user switch (they are not user-keyed).
 */
export async function initClientCacheForUser(userId: string): Promise<void> {
  localCache.setUserScope(userId);
  await localCache.purgeForeignEntries();

  let previousUserId: string | null = null;
  let needsOneTimeSwMigration = false;
  try {
    previousUserId = localStorage.getItem(CLIENT_CACHE_USER_KEY);
    needsOneTimeSwMigration = !localStorage.getItem(SW_DATA_CACHES_V2_KEY);
  } catch {
    // localStorage unavailable — treat as first boot, markers skipped below
  }
  if (previousUserId !== null && previousUserId !== userId) {
    await clearSwDataCaches();
  }
  if (needsOneTimeSwMigration) {
    await clearSwDataCaches();
  }

  // Fire-and-forget: bounded cache growth, never blocks login.
  localCache.sweep().catch(() => {});

  try {
    localStorage.setItem(CLIENT_CACHE_USER_KEY, userId);
    if (needsOneTimeSwMigration) {
      localStorage.setItem(SW_DATA_CACHES_V2_KEY, "1");
    }
  } catch {
    // ignore
  }
}

/** Wipe every client-side data cache — used at logout. */
export async function clearClientData(): Promise<void> {
  await localCache.clearAll();
  localCache.setUserScope(null);
  await clearSwDataCaches();
  try {
    localStorage.removeItem(CLIENT_CACHE_USER_KEY);
    localStorage.removeItem(SW_DATA_CACHES_V2_KEY);
  } catch {
    // ignore
  }
}
