import { describe, expect, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 50)
    })

    const result = await withTimeout(fastPromise, 500)
    expect(result).toBe("fast")
  }, 5000)

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 500)
    })

    await expect(withTimeout(slowPromise, 100)).rejects.toThrow("Operation timed out after 100ms")
  }, 5000)
})
