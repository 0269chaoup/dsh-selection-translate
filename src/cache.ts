/**
 * Host-side bounded cache for translations.
 *
 * One entry costs one model call, so a repeated selection of the same fragment
 * in the same language should not reach the provider twice. The cache is a
 * plain least-recently-used map keyed by a SHA-256 digest of the exact request
 * identity, which keeps one long selection from being re-sent per click and
 * keeps unbounded growth away from a long-running Host process.
 *
 * @module dsh-selection-translate/cache
 */

import { createHash } from 'node:crypto'

/** Latin-1-safe separator that cannot appear in the values it joins. */
const SEPARATOR = '\u0000'

/**
 * Digest the exact request identity.
 * @param parts - request identity fields (text, target language, model route).
 * @returns lowercase hex SHA-256 digest.
 */
export function cacheKey(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join(SEPARATOR), 'utf8').digest('hex')
}

/**
 * A fixed-capacity least-recently-used map.
 *
 * Reads refresh recency, so the entry a user keeps re-reading survives a burst
 * of unrelated translations.
 * @typeParam T - value type.
 */
export class LruCache<T> {
  private readonly entries = new Map<string, T>()

  /**
   * @param capacity - maximum entries kept; `0` disables caching.
   */
  constructor(private capacity: number) {
    this.capacity = Math.max(0, Math.trunc(capacity))
  }

  /** Current entry count. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Read one entry, marking it most recently used.
   * @param key - digest from {@link cacheKey}.
   * @returns the stored value, or undefined on a miss.
   */
  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /**
   * Store one entry, evicting the least recently used one when full.
   * @param key - digest from {@link cacheKey}.
   * @param value - value to store; a zero-capacity cache ignores the call.
   */
  set(key: string, value: T): void {
    if (this.capacity === 0) return
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  /**
   * Change the capacity of a live cache.
   *
   * A row config edit can lower `cacheSize` without re-activating the row, so
   * the running cache has to shrink in place instead of waiting for a remount.
   * @param capacity - new maximum entries kept; `0` disables caching.
   */
  resize(capacity: number): void {
    this.capacity = Math.max(0, Math.trunc(capacity))
    if (this.capacity === 0) {
      this.entries.clear()
      return
    }
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  /** Drop every entry. */
  clear(): void {
    this.entries.clear()
  }
}
