const TRANSIENT = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

function isTransient(err: unknown): boolean {
  if (!err) return false
  const msg = String(err instanceof Error ? err.message : err).toLowerCase()
  return TRANSIENT.some((t) => msg.includes(t))
}

export interface RetryOpts {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (err: unknown) => boolean
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const {
    attempts = 3,
    delay = 500,
    factor = 2,
    maxDelay = 10_000,
    retryIf = isTransient,
  } = opts
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      last = err
      if (i === attempts - 1 || !retryIf(err)) throw err
      const wait = Math.min(delay * Math.pow(factor, i), maxDelay)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last
}
