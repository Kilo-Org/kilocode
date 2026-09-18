import { describe, it, expect } from "bun:test"
import { retry } from "../../src/services/cli-backend/retry"

describe("retry", () => {
  it("returns on first success", async () => {
    const result = await retry(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it("retries transient errors and succeeds", async () => {
    let calls = 0
    const result = await retry(
      () => {
        calls++
        if (calls < 3) throw new TypeError("fetch failed")
        return Promise.resolve("ok")
      },
      3,
      10,
    )
    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })

  it("throws immediately on non-transient errors", async () => {
    let calls = 0
    await expect(
      retry(
        () => {
          calls++
          throw new Error("404 not found")
        },
        3,
        10,
      ),
    ).rejects.toThrow("404 not found")
    expect(calls).toBe(1)
  })

  it("throws after exhausting attempts on transient errors", async () => {
    let calls = 0
    await expect(
      retry(
        () => {
          calls++
          throw new Error("ECONNREFUSED")
        },
        3,
        10,
      ),
    ).rejects.toThrow("ECONNREFUSED")
    expect(calls).toBe(3)
  })

  it("detects all transient error messages", async () => {
    const messages = [
      "load failed",
      "network connection was lost",
      "network request failed",
      "failed to fetch",
      "fetch failed",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "socket hang up",
      "terminated",
    ]
    for (const msg of messages) {
      let calls = 0
      await retry(
        () => {
          calls++
          if (calls === 1) throw new Error(msg)
          return Promise.resolve(true)
        },
        2,
        10,
      )
      expect(calls).toBe(2)
    }
  })

  it("does not retry messages that only contain terminated", async () => {
    let calls = 0
    await expect(
      retry(
        () => {
          calls++
          throw new Error("CLI process terminated by signal SIGSEGV before server started")
        },
        3,
        10,
      ),
    ).rejects.toThrow("terminated")
    expect(calls).toBe(1)
  })
})
