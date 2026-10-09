import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { KiloSessionProcessor } from "../../src/kilocode/session/processor"

// retryOpts is a pure function; the offline handler is not exercised here.
const input = {
  sessionID: "ses_test" as any,
  abort: new AbortController().signal,
  set: () => Effect.void,
}

describe("KiloSessionProcessor.retryOpts", () => {
  it("uses experimental.chatMaxRetries when provided", () => {
    const opts = KiloSessionProcessor.retryOpts({ ...input, chatMaxRetries: 20 })
    expect(opts.limit).toBe(20)
  })

  it("subtracts already-used retries from the configured limit", () => {
    const opts = KiloSessionProcessor.retryOpts({ ...input, chatMaxRetries: 20, used: 3 })
    expect(opts.limit).toBe(17)
  })

  it("clamps the remaining limit at zero", () => {
    const opts = KiloSessionProcessor.retryOpts({ ...input, chatMaxRetries: 2, used: 5 })
    expect(opts.limit).toBe(0)
  })

  it("prefers chatMaxRetries over KILO_SESSION_RETRY_LIMIT", () => {
    process.env.KILO_SESSION_RETRY_LIMIT = "3"
    try {
      const opts = KiloSessionProcessor.retryOpts({ ...input, chatMaxRetries: 20 })
      expect(opts.limit).toBe(20)
    } finally {
      delete process.env.KILO_SESSION_RETRY_LIMIT
    }
  })

  it("falls back to KILO_SESSION_RETRY_LIMIT when chatMaxRetries is unset", () => {
    process.env.KILO_SESSION_RETRY_LIMIT = "7"
    try {
      const opts = KiloSessionProcessor.retryOpts({ ...input })
      expect(opts.limit).toBe(7)
    } finally {
      delete process.env.KILO_SESSION_RETRY_LIMIT
    }
  })

  it("leaves the limit undefined when neither is set", () => {
    delete process.env.KILO_SESSION_RETRY_LIMIT
    const opts = KiloSessionProcessor.retryOpts({ ...input })
    expect(opts.limit).toBeUndefined()
  })
})
