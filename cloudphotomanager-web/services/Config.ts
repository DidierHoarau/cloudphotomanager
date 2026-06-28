const CONFIG = {
  SERVER_URL: "/api",
  STATIC_URL: "/static",
} as const;

let _cachedPromise: Promise<typeof CONFIG> | null = null;

export default class Config {
  /**
   * Synchronous access to the config object.
   * Use this in hot paths to avoid unnecessary `await` overhead.
   */
  static get sync(): typeof CONFIG {
    return CONFIG;
  }

  /**
   * Async accessor kept for backward compatibility with existing `await Config.get()` call sites.
   * Returns a cached resolved promise so there is zero allocation overhead after first call.
   */
  public static get(): Promise<typeof CONFIG> {
    if (!_cachedPromise) {
      _cachedPromise = Promise.resolve(CONFIG);
    }
    return _cachedPromise;
  }
}
