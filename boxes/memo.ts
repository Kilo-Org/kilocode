/**
 * memo.ts — Lazy memoized initializer with reset
 * Zero deps.
 *
 * const getDb = memo(() => openDatabase())
 * getDb() // opens once
 * getDb.reset() // next call reopens
 */
export function memo<T>(fn: () => T) {
  let val: T | undefined
  let ready = false
  const f = (): T => { if (!ready) { val = fn(); ready = true }; return val as T }
  f.reset = () => { ready = false; val = undefined }
  return f
}
