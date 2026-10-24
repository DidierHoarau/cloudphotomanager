/**
 * Lightweight IndexedDB wrapper with TTL support for application data caching.
 * Stores: accounts | folders | fileMetadata
 *
 * Entries are scoped per user: every key is stored as `u:<userId>:<key>` and
 * reads/writes are no-ops until setUserScope() names the current user, so a
 * previous user's cached data can never hydrate into another user's session.
 */

const DB_NAME = "cloudphotomanager-cache";
const DB_VERSION = 1;

const STORES = ["accounts", "folders", "fileMetadata"] as const;
type StoreName = (typeof STORES)[number];

interface CacheEntry<T> {
  key: string;
  data: T;
  /** Epoch ms when this entry was written */
  _ts: number;
}

/** Cache retention per store — entries older than this are swept. */
const STORE_TTL: Record<StoreName, number> = {
  accounts: 24 * 60 * 60 * 1000,
  folders: 24 * 60 * 60 * 1000,
  fileMetadata: 60 * 60 * 1000,
};

/** Hard entry caps per store — oldest entries beyond the cap are evicted. */
const MAX_ENTRIES: Record<StoreName, number> = {
  accounts: 10,
  folders: 10,
  fileMetadata: 200,
};

class LocalCache {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private userScope: string | null = null;

  /** Name the current user for cache scoping (null = no user — cache off). */
  setUserScope(userId: string | null): void {
    this.userScope = userId;
  }

  getCurrentUserScope(): string | null {
    return this.userScope;
  }

  private scopedKey(key: string): string | null {
    if (!this.userScope) return null;
    return `u:${this.userScope}:${key}`;
  }

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "key" });
          }
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.openPromise = null;
        resolve(this.db);
      };

      request.onerror = () => {
        this.openPromise = null;
        reject(request.error);
      };
    });

    return this.openPromise;
  }

  /**
   * Write a value into the given store.
   * No-op while no user scope is set. On quota errors, sweeps the cache and
   * retries once before giving up.
   * @param store  Object store name
   * @param key    Entry key
   * @param data   Arbitrary JSON-serialisable data
   */
  async put<T>(store: StoreName, key: string, data: T): Promise<void> {
    const scopedKey = this.scopedKey(key);
    if (!scopedKey) return;
    try {
      await this.putEntry(store, scopedKey, data);
    } catch (err) {
      if (!isQuotaError(err)) {
        // Silently ignore — cache writes should never break the app.
        console.warn("[LocalCache] put failed", store, key, err);
        return;
      }
      // Free space (expired entries + cap evictions) and retry once.
      try {
        await this.sweep();
        await this.putEntry(store, scopedKey, data);
      } catch (retryErr) {
        console.warn("[LocalCache] put failed after quota sweep", store, key, retryErr);
      }
    }
  }

  private async putEntry<T>(
    store: StoreName,
    scopedKey: string,
    data: T,
  ): Promise<void> {
    const db = await this.open();
    // Deep-clone to strip reactive proxies (Pinia/Vue) so IndexedDB
    // structured clone algorithm does not reject the value.
    const entry: CacheEntry<T> = {
      key: scopedKey,
      data: JSON.parse(JSON.stringify(data)),
      _ts: Date.now(),
    };
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Read a value from the given store.
   * Returns `undefined` when no user scope is set, the key is absent or the
   * entry has expired.
   * @param store     Object store name
   * @param key       Entry key
   * @param maxAgeMs  Optional TTL in milliseconds. Omit to skip TTL check.
   */
  async get<T>(
    store: StoreName,
    key: string,
    maxAgeMs?: number,
  ): Promise<T | undefined> {
    const scopedKey = this.scopedKey(key);
    if (!scopedKey) return undefined;
    try {
      const db = await this.open();
      const entry: CacheEntry<T> | undefined = await new Promise<
        CacheEntry<T> | undefined
      >((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(scopedKey);
        req.onsuccess = () => resolve(req.result as CacheEntry<T> | undefined);
        req.onerror = () => reject(req.error);
      });

      if (!entry) return undefined;

      // TTL check
      if (maxAgeMs !== undefined && Date.now() - entry._ts > maxAgeMs) {
        // Expired — fire-and-forget delete
        this.delete(store, key).catch(() => {});
        return undefined;
      }

      return entry.data;
    } catch (err) {
      console.warn("[LocalCache] get failed", store, key, err);
      return undefined;
    }
  }

  /** Delete a single key from a store. No-op while no user scope is set. */
  async delete(store: StoreName, key: string): Promise<void> {
    const scopedKey = this.scopedKey(key);
    if (!scopedKey) return;
    try {
      const db = await this.open();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(scopedKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("[LocalCache] delete failed", store, key, err);
    }
  }

  /** Clear all entries from a store. */
  async clear(store: StoreName): Promise<void> {
    try {
      const db = await this.open();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("[LocalCache] clear failed", store, err);
    }
  }

  /** Clear every store, ignoring the user scope (logout / user switch). */
  async clearAll(): Promise<void> {
    for (const store of STORES) {
      await this.clear(store);
    }
  }

  /**
   * Delete every entry that does not belong to the current user scope,
   * including legacy unscoped keys — migrates pre-scoping client caches.
   * With no scope set, deletes everything (nothing is readable anyway).
   */
  async purgeForeignEntries(): Promise<void> {
    const prefix = this.userScope ? `u:${this.userScope}:` : null;
    try {
      const db = await this.open();
      for (const store of STORES) {
        const foreignKeys: string[] = [];
        const keys: string[] = await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction(store, "readonly");
          const req = tx.objectStore(store).getAllKeys();
          req.onsuccess = () =>
            resolve((req.result as IDBValidKey[]).map(String));
          req.onerror = () => reject(req.error);
        });
        for (const key of keys) {
          if (!prefix || !key.startsWith(prefix)) {
            foreignKeys.push(key);
          }
        }
        if (foreignKeys.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            for (const key of foreignKeys) {
              tx.objectStore(store).delete(key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
      }
    } catch (err) {
      console.warn("[LocalCache] purgeForeignEntries failed", err);
    }
  }

  /**
   * Bounded-growth sweep: delete expired entries (store TTL), then evict the
   * oldest entries beyond the per-store cap. Safe to run at any time.
   */
  async sweep(): Promise<void> {
    try {
      const db = await this.open();
      const now = Date.now();
      for (const store of STORES) {
        const entries: CacheEntry<unknown>[] = await new Promise<
          CacheEntry<unknown>[]
        >((resolve, reject) => {
          const tx = db.transaction(store, "readonly");
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () =>
            resolve((req.result || []) as CacheEntry<unknown>[]);
          req.onerror = () => reject(req.error);
        });
        const toDelete: string[] = [];
        const kept: CacheEntry<unknown>[] = [];
        for (const entry of entries) {
          if (now - entry._ts > STORE_TTL[store]) {
            toDelete.push(entry.key);
          } else {
            kept.push(entry);
          }
        }
        if (kept.length > MAX_ENTRIES[store]) {
          const evict = kept
            .sort((a, b) => a._ts - b._ts)
            .slice(0, kept.length - MAX_ENTRIES[store]);
          toDelete.push(...evict.map((e) => e.key));
        }
        if (toDelete.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            for (const key of toDelete) {
              tx.objectStore(store).delete(key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
      }
    } catch (err) {
      console.warn("[LocalCache] sweep failed", err);
    }
  }
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

export const localCache = new LocalCache();

// ─── Convenience TTL constants ────────────────────────────────────────────────
export const TTL = {
  /** 1 hour – file metadata pages */
  FILE_METADATA: 60 * 60 * 1000,
  /** 24 hours – folder trees, account list */
  FOLDERS: 24 * 60 * 60 * 1000,
  ACCOUNTS: 24 * 60 * 60 * 1000,
} as const;
