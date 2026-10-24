import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const DB_NAME = "cloudphotomanager-cache";
const STORES = ["accounts", "folders", "fileMetadata"];

// Fresh IndexedDB factory per test for isolation.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as any;
});

// localCache is a singleton holding the opened DB connection: import the
// module fresh per test so every test gets a clean instance.
async function freshLocalCache() {
  vi.resetModules();
  const mod = await import("../services/LocalCache");
  return mod.localCache;
}

function rawOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "key" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rawGet(store: string, key: string): Promise<any> {
  const db = await rawOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function rawPut(store: string, entry: any): Promise<void> {
  const db = await rawOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function rawCount(store: string): Promise<number> {
  const db = await rawOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).count();
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

describe("LocalCache user scoping", () => {
  it("is a no-op while no user scope is set", async () => {
    const localCache = await freshLocalCache();
    await localCache.put("folders", "all", [{ id: "f1" }]);
    await expect(localCache.get("folders", "all")).resolves.toBeUndefined();
    await localCache.delete("folders", "all");
    // The database was never even created (no store writes happened).
    const dbs = await indexedDB.databases();
    expect(
      dbs.find((d) => d.name === DB_NAME)?.version,
    ).toBeUndefined();
  });

  it("stores entries under u:<userId>:<key> and round-trips", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    const tree = [{ id: "f1", folderpath: "/" }];
    await localCache.put("folders", "all", tree);
    const raw = await rawGet("folders", "u:uA:all");
    expect(raw).toBeDefined();
    expect(raw.key).toBe("u:uA:all");
    expect(raw.data).toEqual(tree);
    await expect(localCache.get("folders", "all")).resolves.toEqual(tree);
  });

  it("hides the previous user's data after a user switch", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    await localCache.put("accounts", "all", [{ id: "accA" }]);
    localCache.setUserScope("uB");
    await expect(localCache.get("accounts", "all")).resolves.toBeUndefined();
    await localCache.put("accounts", "all", [{ id: "accB" }]);
    await expect(localCache.get("accounts", "all")).resolves.toEqual([
      { id: "accB" },
    ]);
  });

  it("purgeForeignEntries removes other-user and legacy unscoped entries", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    await localCache.put("folders", "all", [{ id: "fA" }]);
    // Simulate a pre-scoping cache entry and a third user's entry.
    await rawPut("folders", {
      key: "all",
      data: [{ legacy: true }],
      _ts: Date.now(),
    });
    await rawPut("folders", {
      key: "u:uC:all",
      data: [{ id: "fC" }],
      _ts: Date.now(),
    });

    localCache.setUserScope("uB");
    await localCache.put("folders", "all", [{ id: "fB" }]);
    await localCache.purgeForeignEntries();

    expect(await rawGet("folders", "u:uA:all")).toBeUndefined();
    expect(await rawGet("folders", "all")).toBeUndefined();
    expect(await rawGet("folders", "u:uC:all")).toBeUndefined();
    expect(await rawGet("folders", "u:uB:all")).toBeDefined();
    await expect(localCache.get("folders", "all")).resolves.toEqual([
      { id: "fB" },
    ]);
  });

  it("clearAll with unset scope leaves nothing readable (logout)", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    await localCache.put("folders", "all", [{ id: "fA" }]);
    await localCache.put("fileMetadata", "a:f:0:60", { files: [] });

    await localCache.clearAll();
    localCache.setUserScope(null);

    await expect(localCache.get("folders", "all")).resolves.toBeUndefined();
    await expect(
      localCache.get("fileMetadata", "a:f:0:60"),
    ).resolves.toBeUndefined();
    expect(await rawCount("folders")).toBe(0);
    expect(await rawCount("fileMetadata")).toBe(0);
    expect(await rawCount("accounts")).toBe(0);
  });
});

describe("LocalCache bounded growth", () => {
  it("sweep deletes expired entries", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    await localCache.put("fileMetadata", "fresh", { files: [1] });
    await localCache.put("fileMetadata", "stale", { files: [2] });
    // Back-date the stale entry beyond the 1h fileMetadata TTL.
    const stale = await rawGet("fileMetadata", "u:uA:stale");
    await rawPut("fileMetadata", {
      ...stale,
      _ts: Date.now() - 2 * 60 * 60 * 1000,
    });

    await localCache.sweep();

    expect(await rawGet("fileMetadata", "u:uA:stale")).toBeUndefined();
    expect(await rawGet("fileMetadata", "u:uA:fresh")).toBeDefined();
  });

  it("sweep evicts the oldest entries beyond the per-store cap", async () => {
    const localCache = await freshLocalCache();
    localCache.setUserScope("uA");
    const now = Date.now();
    // 205 entries in the fileMetadata store (cap 200): page000 is the oldest.
    for (let i = 0; i < 205; i++) {
      await rawPut("fileMetadata", {
        key: `u:uA:page${String(i).padStart(3, "0")}`,
        data: { page: i },
        _ts: now - (205 - i) * 1000,
      });
    }

    await localCache.sweep();

    expect(await rawCount("fileMetadata")).toBe(200);
    expect(await rawGet("fileMetadata", "u:uA:page000")).toBeUndefined();
    expect(await rawGet("fileMetadata", "u:uA:page004")).toBeUndefined();
    expect(await rawGet("fileMetadata", "u:uA:page005")).toBeDefined();
    expect(await rawGet("fileMetadata", "u:uA:page204")).toBeDefined();
  });
});
