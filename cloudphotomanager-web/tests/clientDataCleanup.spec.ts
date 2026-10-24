import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { SW_DATA_CACHE_NAMES } from "../services/ClientDataCleanup";

const DATA_CACHE_NAMES = Object.values(SW_DATA_CACHE_NAMES);

function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

function stubCaches(): { deleted: string[] } {
  const deleted: string[] = [];
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => [...DATA_CACHE_NAMES, "static-assets"]),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  });
  return { deleted };
}

// Import the module graph fresh per test: ClientDataCleanup and LocalCache
// both hold module-level singletons.
async function freshModules() {
  vi.resetModules();
  const cleanup = await import("../services/ClientDataCleanup");
  const cache = await import("../services/LocalCache");
  return { cleanup, localCache: cache.localCache };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as any;
  vi.stubGlobal("localStorage", makeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ClientDataCleanup", () => {
  it("clearClientData wipes IndexedDB, SW data caches and markers", async () => {
    const { cleanup, localCache } = await freshModules();
    const { deleted } = stubCaches();
    localStorage.setItem("clientCacheUserId", "uA");
    localStorage.setItem("swDataCachesV2", "1");
    localCache.setUserScope("uA");
    await localCache.put("folders", "all", [{ id: "f1" }]);

    await cleanup.clearClientData();

    expect([...deleted].sort()).toEqual([...DATA_CACHE_NAMES].sort());
    expect(deleted).not.toContain("static-assets");
    await expect(localCache.get("folders", "all")).resolves.toBeUndefined();
    expect(localStorage.getItem("clientCacheUserId")).toBeNull();
    expect(localStorage.getItem("swDataCachesV2")).toBeNull();
  });

  it("clearClientData works without the Cache Storage API", async () => {
    const { cleanup } = await freshModules();
    vi.stubGlobal("caches", undefined);
    await expect(cleanup.clearClientData()).resolves.toBeUndefined();
  });

  it("initClientCacheForUser clears SW data caches on user switch", async () => {
    const { cleanup } = await freshModules();
    const { deleted } = stubCaches();
    localStorage.setItem("clientCacheUserId", "oldUser");
    // The one-time migration already ran for the previous user.
    localStorage.setItem("swDataCachesV2", "1");

    await cleanup.initClientCacheForUser("newUser");

    expect([...deleted].sort()).toEqual([...DATA_CACHE_NAMES].sort());
    expect(localStorage.getItem("clientCacheUserId")).toBe("newUser");
  });

  it("initClientCacheForUser keeps SW data caches for the same user", async () => {
    const { cleanup } = await freshModules();
    const { deleted } = stubCaches();
    localStorage.setItem("clientCacheUserId", "sameUser");
    localStorage.setItem("swDataCachesV2", "1");

    await cleanup.initClientCacheForUser("sameUser");

    expect(deleted).toEqual([]);
    expect(localStorage.getItem("clientCacheUserId")).toBe("sameUser");
  });

  it("one-time migration clears SW data caches on the first boot only", async () => {
    const { cleanup } = await freshModules();
    const { deleted } = stubCaches();

    // First boot: no markers — migration deletes all SW data caches once.
    await cleanup.initClientCacheForUser("firstUser");
    expect([...deleted].sort()).toEqual([...DATA_CACHE_NAMES].sort());
    expect(localStorage.getItem("swDataCachesV2")).toBe("1");

    // Second boot for the same user: nothing left to delete.
    deleted.length = 0;
    await cleanup.initClientCacheForUser("firstUser");
    expect(deleted).toEqual([]);
  });
});
