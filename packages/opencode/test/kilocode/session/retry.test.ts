import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Schema } from "effect"
import { SessionRetry } from "../../../src/session/retry"
import { SessionRetryKilo } from "../../../src/kilocode/session/retry"

function apiError(input?: { headers?: Record<string, string>; message?: string }): SessionV1.APIError {
  return Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
    new SessionV1.APIError({
      message: input?.message ?? "boom",
      isRetryable: true,
      responseHeaders: input?.headers,
    }).toObject(),
  )
}

describe("kilocode session.retry ratelimit reset", () => {
  test("reads the requests reset header as a duration", () => {
    const error = apiError({ headers: { "x-ratelimit-reset-requests": "9s" } })
    expect(SessionRetryKilo.reset(error)).toBe(9_500)
  })

  test("sums compound durations", () => {
    const error = apiError({ headers: { "x-ratelimit-reset-requests": "1m30s" } })
    expect(SessionRetryKilo.reset(error)).toBe(90_500)
  })

  test("accepts milliseconds and hours", () => {
    expect(SessionRetryKilo.reset(apiError({ headers: { "x-ratelimit-reset-requests": "500ms" } }))).toBe(1_000)
    expect(SessionRetryKilo.reset(apiError({ headers: { "ratelimit-unified-reset": "1h" } }))).toBe(3_600_500)
  })

  test("treats a bare small number as seconds", () => {
    const error = apiError({ headers: { "x-ratelimit-reset": "12" } })
    expect(SessionRetryKilo.reset(error)).toBe(12_500)
  })

  test("treats an epoch-like reset as an absolute time", () => {
    const error = apiError({ headers: { "x-ratelimit-reset": String(Math.floor((Date.now() + 20_000) / 1_000)) } })
    const reset = SessionRetryKilo.reset(error)
    expect(reset).toBeDefined()
    expect(reset!).toBeGreaterThan(19_000)
    expect(reset!).toBeLessThanOrEqual(20_500)
  })

  test("falls back to the try-again message when headers are absent", () => {
    const error = apiError({
      message: "Too Many Requests: Rate limit reached for glm-5.3 on requests per min (RPM): Limit 10, Used 10. Please try again in 9s.",
    })
    expect(SessionRetryKilo.reset(error)).toBe(9_500)
  })

  test("falls back to the try-again phrase in the response body", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Too Many Requests",
        isRetryable: true,
        responseBody: '{"description":"RATE_LIMITED","message":"Rate limit reached. Please try again in 30s."}',
      }).toObject(),
    )
    expect(SessionRetryKilo.reset(error)).toBe(30_500)
  })

  test("ignores zero, negative, and garbage resets", () => {
    expect(SessionRetryKilo.reset(apiError({ headers: { "x-ratelimit-reset-requests": "0s" } }))).toBeUndefined()
    expect(SessionRetryKilo.reset(apiError({ headers: { "x-ratelimit-reset-requests": "soon" } }))).toBeUndefined()
    expect(SessionRetryKilo.reset(apiError({ headers: { "x-ratelimit-reset": "-5" } }))).toBeUndefined()
    expect(SessionRetryKilo.reset(apiError())).toBeUndefined()
  })

  test("delay waits out the advertised reset instead of the exponential backoff", () => {
    const error = apiError({ headers: { "x-ratelimit-reset-requests": "9s" } })
    expect(SessionRetry.delay(1, error, 0)).toBe(9_500)
  })

  test("retry-after still wins over the rate-limit reset", () => {
    const error = apiError({ headers: { "retry-after-ms": "1500", "x-ratelimit-reset-requests": "9s" } })
    expect(SessionRetry.delay(1, error)).toBe(1_500)
  })
})
