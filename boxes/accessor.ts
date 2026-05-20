/**
 * accessor.ts — Reflection-free getter/setter binding (huh Accessor pattern)
 *
 * Decouples field values from UI components or data structures.
 * Instead of reflection, use explicit getter/setter functions
 * that can bind to any data source.
 * Zero deps.
 */

export interface Accessor<T> {
  get(): T
  set(value: T): void
}

/** Create an accessor bound to a property on an object. */
export function prop<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  key: K,
): Accessor<T[K]> {
  return {
    get: () => obj[key],
    set: (v) => { obj[key] = v },
  }
}

/** Create an accessor from explicit getter/setter functions. */
export function field<T>(get: () => T, set: (v: T) => void): Accessor<T> {
  return { get, set }
}

/** Create an accessor backed by a simple mutable reference. */
export function ref<T>(initial: T): Accessor<T> {
  let val = initial
  return {
    get: () => val,
    set: (v) => { val = v },
  }
}
