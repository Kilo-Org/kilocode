/**
 * gate.ts — Deferred promise trigger
 * Zero deps.
 *
 * const g = gate()
 * setTimeout(() => g.release(), 1000)
 * await g.wait()
 */
export function gate<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { release: (v?: T) => resolve(v as T), wait: () => promise }
}
