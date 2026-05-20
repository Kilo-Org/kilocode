/**
 * ttl-cache.ts — Generic TTL cache with Map/WeakMap storage
 * Ported from gemini-cli CacheService (Apache-2.0)
 * Deps: none
 */
export interface CacheOpts {
  defaultTtl?: number
  storage?: "map" | "weakmap"
}

interface Entry<V> { value: V; ts: number; ttl?: number }

export class TTLCache<K extends object | string | undefined, V> {
  private store: Map<K, Entry<V>> | WeakMap<WeakKey, Entry<V>>
  private defaultTtl?: number

  constructor(opts: CacheOpts = {}) {
    this.store = opts.storage === "weakmap"
      ? new WeakMap<WeakKey, Entry<V>>()
      : new Map<K, Entry<V>>()
    this.defaultTtl = opts.defaultTtl
  }

  get(key: K): V | undefined {
    const e = (this.store as any).get(key) as Entry<V> | undefined
    if (!e) return undefined
    const ttl = e.ttl ?? this.defaultTtl
    if (ttl !== undefined && Date.now() - e.ts > ttl) {
      this.delete(key)
      return undefined
    }
    return e.value
  }

  set(key: K, value: V, ttl?: number): void {
    (this.store as any).set(key, { value, ts: Date.now(), ttl })
  }

  getOrCreate(key: K, creator: () => V, ttl?: number): V {
    const v = this.get(key)
    if (v !== undefined) return v
    const created = creator()
    this.set(key, created, ttl)
    return created
  }

  delete(key: K): void { (this.store as any).delete(key) }

  clear(): void {
    if (this.store instanceof Map) this.store.clear()
    else throw new Error("clear() not supported on WeakMap")
  }
}

export function createCache<K extends string | undefined, V>(
  opts: CacheOpts & { storage: "map" },
): TTLCache<K, V>
export function createCache<K extends object, V>(opts?: CacheOpts): TTLCache<K, V>
export function createCache<K extends object | string | undefined, V>(
  opts: CacheOpts = {},
): TTLCache<K, V> {
  return new TTLCache<K, V>(opts)
}
