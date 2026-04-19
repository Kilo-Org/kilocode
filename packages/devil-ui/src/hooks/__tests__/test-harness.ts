import { createRoot } from "solid-js"

/**
 * Run a function inside a SolidJS reactive root.
 * Use this instead of @solidjs/testing-library to avoid heavy deps.
 *
 * IMPORTANT: Hooks must subscribe synchronously in their body (not inside onMount)
 * because createRoot does not trigger a render cycle.
 */
export function withRoot<T>(body: (dispose: () => void) => T): T {
  let result!: T
  createRoot((dispose) => {
    result = body(dispose)
  })
  return result
}
