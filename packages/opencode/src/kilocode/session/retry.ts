// kilocode_change - new file
import { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace SessionRetryKilo {
  /** Padding past the advertised reset so a retry cannot race the window flip. */
  const BUFFER_MS = 500

  /** Rate-limit window reset headers, most specific first. */
  const headers = ["x-ratelimit-reset-requests", "ratelimit-unified-reset", "ratelimit-requests-reset", "x-ratelimit-reset"]

  const units: Record<string, number> = {
    ms: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1_000,
    second: 1_000,
    seconds: 1_000,
    m: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
  }

  /** "9s", "1m30s", "500ms" -> milliseconds */
  function span(value: string) {
    let total = 0
    let seen = false
    for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
      seen = true
      total += Number.parseFloat(match[1]) * (units[match[2]] ?? 0)
    }
    return seen ? total : undefined
  }

  function parse(value: string) {
    const ms = span(value)
    if (ms !== undefined) return ms
    const n = Number.parseFloat(value)
    if (Number.isNaN(n) || n <= 0) return undefined
    // a bare small number is seconds; an epoch-like one is an absolute reset time
    if (n < 3_600) return n * 1_000
    const epoch = n > 1e12 ? n : n * 1_000
    return epoch - Date.now()
  }

  /**
   * Advertised rate-limit window reset for the error: how long to wait for a
   * retry to clear the limit. Providers that rate-limit by requests per minute
   * advertise the reset in x-ratelimit headers instead of retry-after; without
   * it, exponential backoff retries inside the window and burns every attempt.
   * Falls back to the "try again in 9s" phrasing in the message body.
   */
  export function reset(error: SessionV1.APIError) {
    for (const name of headers) {
      const value = error.data.responseHeaders?.[name]
      if (typeof value !== "string") continue
      const ms = parse(value.trim())
      if (ms !== undefined && ms > 0) return Math.ceil(ms) + BUFFER_MS
    }
    for (const text of [error.data.message, error.data.responseBody]) {
      if (typeof text !== "string") continue
      const match = text.match(/try again in (\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|ms|s|m|h)\b/i)
      if (!match) continue
      const ms = Number.parseFloat(match[1]) * (units[match[2].toLowerCase()] ?? 0)
      if (ms > 0) return Math.ceil(ms) + BUFFER_MS
    }
    return undefined
  }
}
