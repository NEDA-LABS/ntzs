/**
 * Simple in-memory TTL cache for server-side data.
 * Eliminates redundant DB round-trips on repeated navigations.
 * Each entry auto-expires after `ttlMs` milliseconds.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class MemCache<T> {
  private store = new Map<string, CacheEntry<T>>()

  constructor(private ttlMs: number = 30_000) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }
}
