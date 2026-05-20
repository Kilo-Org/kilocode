/**
 * delay.ts — Abort-aware setTimeout
 * Ported from gemini-cli (Apache-2.0)
 * Deps: none
 */
export function createAbortError(): Error {
  const e = new Error("Aborted")
  e.name = "AbortError"
  return e
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(r => setTimeout(r, ms))
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(tid)
      signal.removeEventListener("abort", onAbort)
      reject(createAbortError())
    }
    const tid = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
