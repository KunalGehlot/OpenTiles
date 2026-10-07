// Fixed-window rate limiting, in memory only. Client addresses are keyed through a salted hash
// that is regenerated on every start and never written anywhere, so no IP address is stored.
import { createHash, randomBytes } from 'node:crypto';

export interface RateLimiter {
  /** Counts one hit; returns false when `key` is over `limit` within the window. */
  hit(key: string, limit: number, windowMs: number, now: number): boolean;
  /** Turns a client address into an opaque, process-local key. */
  clientKey(address: string): string;
  size(): number;
}

export function createRateLimiter(): RateLimiter {
  const salt = randomBytes(32);
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;

  function sweep(now: number): void {
    if (now - lastSweep < 60_000 && windows.size < 50_000) return;
    lastSweep = now;
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }

  return {
    hit(key, limit, windowMs, now) {
      sweep(now);
      const w = windows.get(key);
      if (w === undefined || w.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return limit >= 1;
      }
      w.count += 1;
      return w.count <= limit;
    },
    clientKey(address) {
      return createHash('sha256').update(salt).update(address).digest('base64url').slice(0, 22);
    },
    size() {
      return windows.size;
    },
  };
}
