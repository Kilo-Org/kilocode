/**
 * toolbox.ts — Dependency injection container (gluegun Toolbox pattern)
 *
 * Register providers by key, then build an aggregated context object.
 * Providers are lazy: first `build()` calls them and caches results.
 * Zero deps.
 */

type Provider<T> = (ctx: Record<string, unknown>) => T | Promise<T>

export function toolbox() {
  const providers = new Map<string, Provider<unknown>>()
  const cache = new Map<string, unknown>()

  return {
    /** Register a provider under a key. Called once on first build. */
    provide<T>(key: string, fn: Provider<T>) {
      providers.set(key, fn as Provider<unknown>)
    },

    /** Build (or return cached) context with all providers resolved. */
    async build(): Promise<Record<string, unknown>> {
      const ctx: Record<string, unknown> = {}
      for (const [key, fn] of providers) {
        if (!cache.has(key)) {
          cache.set(key, await fn(ctx))
        }
        ctx[key] = cache.get(key)
      }
      return ctx
    },

    /** Clear cached providers, forcing re-initialization on next build. */
    reset() {
      cache.clear()
    },
  }
}
