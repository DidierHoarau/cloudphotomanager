// Dependency-free fixed-window throttle for credential endpoints. The agent
// configuration assumes a single server process per deployment, so an
// in-memory map is enough; entries are dropped opportunistically once their
// window has elapsed.
interface ThrottleBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, ThrottleBucket>();
const MAX_TRACKED_KEYS = 10_000;

export interface LoginThrottleResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

// Counts one attempt for `key` and reports whether it is still within the
// limit. `windowSeconds` is the fixed-window size.
export function LoginThrottleHit(
  key: string,
  limit: number,
  windowSeconds = 60,
): LoginThrottleResult {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_KEYS) {
    pruneExpired(now);
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Test helper: clears all windows so specs do not leak state into each other.
export function LoginThrottleReset(): void {
  buckets.clear();
}
