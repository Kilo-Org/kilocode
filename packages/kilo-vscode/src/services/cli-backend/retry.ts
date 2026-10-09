// Replicated from packages/core/src/util/retry.ts to avoid adding @opencode-ai/core
// as a dependency of the extension. Keep in sync with the original.

const TRANSIENT = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "fetch failed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

// Undici raises `TypeError: terminated` when a pooled connection is closed
// before the response completes. Match it exactly so unrelated messages that
// merely contain the word stay fatal.
const TRANSIENT_EXACT = ["terminated"]

function transient(error: unknown): boolean {
  if (!error) return false
  const msg = String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .trim()
  if (TRANSIENT_EXACT.includes(msg)) return true
  return TRANSIENT.some((m) => msg.includes(m))
}

export async function retry<T>(fn: () => Promise<T>, attempts = 3, delay = 500): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      last = error
      if (i === attempts - 1 || !transient(error)) throw error
      await new Promise((r) => setTimeout(r, delay * 2 ** i))
    }
  }
  throw last
}
