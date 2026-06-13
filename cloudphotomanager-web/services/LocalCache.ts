/**
 * Lightweight IndexedDB wrapper with TTL support for application data caching.
 * Stores: accounts | folders | fileMetadata
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

class LocalCache {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;

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
   * @param store  Object store name
   * @param key    Entry key
   * @param data   Arbitrary JSON-serialisable data
   */
  async put<T>(store: StoreName, key: string, data: T): Promise<void> {
    try {
      const db = await this.open();
      // Deep-clone to strip reactive proxies (Pinia/Vue) so IndexedDB
      // structured clone algorithm does not reject the value.
      const entry: CacheEntry<T> = {
        key,
        data: JSON.parse(JSON.stringify(data)),
        _ts: Date.now(),
      };
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      // Silently ignore — cache writes should never break the app.
      console.warn("[LocalCache] put failed", store, key, err);
    }
  }

  /**
   * Read a value from the given store.
   * Returns `undefined` when the key is absent or the entry has expired.
   * @param store     Object store name
   * @param key       Entry key
   * @param maxAgeMs  Optional TTL in milliseconds. Omit to skip TTL check.
   */
  async get<T>(
    store: StoreName,
    key: string,
    maxAgeMs?: number,
  ): Promise<T | undefined> {
    try {
      const db = await this.open();
      const entry: CacheEntry<T> | undefined = await new Promise<
        CacheEntry<T> | undefined
      >((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
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

  /** Delete a single key from a store. */
  async delete(store: StoreName, key: string): Promise<void> {
    try {
      const db = await this.open();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
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
