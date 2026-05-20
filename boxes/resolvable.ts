/**
 * resolvable.ts — Type-level lazy loading (citty Resolvable<T> pattern)
 *
 * Handles values that may be direct, promised, or lazily computed:
 *   T | Promise<T> | (() => T) | (() => Promise<T>)
 * Zero deps.
 */

export type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>)

/** Resolve a Resolvable to its concrete value. */
export async function resolve<T>(val: Resolvable<T>): Promise<T> {
  if (typeof val === "function") {
    return await (val as () => T | Promise<T>)()
  }
  return val
}

/** Resolve synchronously — throws if the result is a Promise. */
export function resolveSync<T>(val: Resolvable<T>): T {
  if (typeof val === "function") {
    return (val as () => T)()
  }
  return val
}

/** Check if a Resolvable is a function (lazy). */
export function isLazy<T>(val: Resolvable<T>): val is () => T | Promise<T> {
  return typeof val === "function"
}

/** Wrap a value as a lazy Resolvable (defers evaluation). */
export function lazy<T>(fn: () => T | Promise<T>): Resolvable<T> {
  return fn
}
