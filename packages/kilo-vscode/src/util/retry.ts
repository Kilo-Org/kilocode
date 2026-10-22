/**
 * Exponential backoff retry utilities for rate-limited API calls.
 *
 * When the CLI backend (or the upstream AI provider it proxies) returns
 * HTTP 429, retries are scheduled with exponential backoff. The delay
 * respects `Retry-After` / `Retry-After-MS` headers when present.
 */

/** Backoff delays per attempt: 5s -> 10s -> 30s -> 60s -> 300s */
const BACKOFF_DELAYS_MS = [5_000, 10_000, 30_000, 60_000, 300_000]

/** Maximum backoff delay in ms (5 minutes) */
const MAX_MS = 300_000

/** Maximum number of retry attempts */
const MAX_RETRIES = BACKOFF_DELAYS_MS.length

/** HTTP status codes that are safe to retry */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504])

/**
 * Whether an HTTP status code is retryable.
 */
export function retryable(status: number): boolean {
  if (RETRYABLE.has(status)) return true
  return status >= 500
}

/**
 * Extract a retry delay (in ms) from standard response headers.
 *
 * Checks `retry-after-ms` first (milliseconds), then `retry-after`
 * (seconds or HTTP-date). Returns `null` when no usable header is found.
 */
export function headerDelay(headers: Headers): number | null {
  const ms = headers.get("retry-after-ms")
  if (ms) {
    const parsed = Number.parseFloat(ms)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }

  const after = headers.get("retry-after")
  if (after) {
    const seconds = Number.parseFloat(after)
    if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds * 1000)
    // Try HTTP-date format
    const date = Date.parse(after) - Date.now()
    if (!Number.isNaN(date) && date > 0) return Math.ceil(date)
  }

  return null
}

/**
 * Calculate backoff delay for a given attempt.
 *
 * If `headers` are provided and contain a `Retry-After` value, that
 * value is used (capped at MAX_MS). Otherwise uses the predefined
 * backoff schedule: 5s, 10s, 30s, 60s, 300s.
 */
export function backoff(attempt: number, headers?: Headers): number {
  if (headers) {
    const fromHeader = headerDelay(headers)
    if (fromHeader !== null) return Math.min(fromHeader, MAX_MS)
  }
  const index = Math.min(attempt - 1, BACKOFF_DELAYS_MS.length - 1)
  return BACKOFF_DELAYS_MS[index] ?? MAX_MS
}

export { MAX_RETRIES, MAX_MS }
