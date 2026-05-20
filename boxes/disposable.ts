/**
 * disposable.ts — Wrap cleanup fn as Disposable + AsyncDisposable
 * Zero deps.
 *
 * const d = disposable(() => console.log("cleaned"))
 * using d = disposable(() => cleanup())
 */
export function disposable(fn: () => void | Promise<void>): AsyncDisposable & Disposable {
  return {
    [Symbol.dispose]() { void fn() },
    [Symbol.asyncDispose]() { return Promise.resolve(fn()) },
  }
}
