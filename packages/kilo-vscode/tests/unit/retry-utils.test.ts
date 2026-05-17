import { describe, expect, it } from "bun:test"
import { backoff, headerDelay, retryable } from "../../src/util/retry"

describe("retry utilities", () => {
  it("retries SDK failures that do not include an HTTP response", () => {
    expect(retryable(0)).toBe(true)
  })

  it("retries transient HTTP statuses", () => {
    expect(retryable(429)).toBe(true)
    expect(retryable(503)).toBe(true)
  })

  it("does not retry regular client errors", () => {
    expect(retryable(400)).toBe(false)
  })

  it("uses retry-after-ms before the fallback schedule", () => {
    expect(backoff(3, new Headers({ "retry-after-ms": "1500" }))).toBe(1500)
  })

  it("returns null for invalid retry headers", () => {
    expect(headerDelay(new Headers({ "retry-after": "not-a-date" }))).toBeNull()
  })
})
