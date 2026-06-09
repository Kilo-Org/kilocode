import type { CacheStats } from '../types'
import { LOG_PREFIX } from '../constants'

export class ModelStatusCache {
  private cache = new Map<
    string,
    {
      models: string[]
      timestamp: number
      ttl: number
    }
  >()

  private readonly DEFAULT_TTL = 15000
  private readonly MAX_CACHE_SIZE = 50

  async getModels(baseURL: string, fetchFn: () => Promise<string[]>): Promise<string[]> {
    const now = Date.now()
    const cached = this.cache.get(baseURL)

    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.models
    }

    try {
      const models = await fetchFn()
      this.cache.set(baseURL, {
        models: [...models],
        timestamp: now,
        ttl: this.DEFAULT_TTL,
      })

      if (this.cache.size > this.MAX_CACHE_SIZE) {
        this.cleanup()
      }

      return models
    } catch (error) {
      if (cached) {
        console.warn(`${LOG_PREFIX} Using stale cache data due to fetch error`, {
          baseURL,
          age: now - cached.timestamp,
          error: error instanceof Error ? error.message : String(error),
        })
        if (now - cached.timestamp > cached.ttl * 5) {
          this.invalidate(baseURL)
        }
        return cached.models
      }
      throw error
    }
  }

  invalidate(baseURL: string): void {
    this.cache.delete(baseURL)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  async forceRefresh(baseURL: string, fetchFn: () => Promise<string[]>): Promise<string[]> {
    this.invalidate(baseURL)
    return this.getModels(baseURL, fetchFn)
  }

  getStats(): CacheStats {
    const now = Date.now()
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([baseURL, data]) => ({
        baseURL,
        age: now - data.timestamp,
        modelCount: data.models.length,
        ttl: data.ttl,
      })),
    }
  }

  private cleanup(): void {
    const now = Date.now()
    const entries = Array.from(this.cache.entries())

    for (const [baseURL, data] of entries) {
      if (now - data.timestamp > data.ttl * 5) {
        this.cache.delete(baseURL)
      }
    }

    if (this.cache.size <= this.MAX_CACHE_SIZE) {
      return
    }

    const sorted = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )
    const excess = this.cache.size - this.MAX_CACHE_SIZE
    for (let i = 0; i < excess; i++) {
      this.cache.delete(sorted[i]![0])
    }
  }

  setTTL(baseURL: string, ttl: number): void {
    const cached = this.cache.get(baseURL)
    if (cached) {
      cached.ttl = ttl
    }
  }

  isValid(baseURL: string): boolean {
    const cached = this.cache.get(baseURL)
    const now = Date.now()
    return cached !== undefined && now - cached.timestamp < cached.ttl
  }
}
