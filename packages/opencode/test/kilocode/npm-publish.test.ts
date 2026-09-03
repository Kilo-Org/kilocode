import { describe, expect, test } from "bun:test"
import { NpmPublish } from "../../script/kilocode/npm-publish"

describe("npm publish retry", () => {
  test("returns after the first successful attempt", async () => {
    const calls = { run: 0, exists: 0, sleep: 0 }

    await NpmPublish.retry({
      name: "@kilocode/test",
      version: "1.0.0",
      run: async () => {
        calls.run++
      },
      exists: async () => {
        calls.exists++
        return false
      },
      sleep: async () => {
        calls.sleep++
      },
    })

    expect(calls).toEqual({ run: 1, exists: 0, sleep: 0 })
  })

  test("accepts a version that landed after a failed command", async () => {
    const calls = { run: 0, exists: 0, sleep: 0 }
    const err = new Error("connection closed")

    await NpmPublish.retry({
      name: "@kilocode/test",
      version: "1.0.0",
      run: async () => {
        calls.run++
        throw err
      },
      exists: async () => {
        calls.exists++
        return true
      },
      sleep: async () => {
        calls.sleep++
      },
    })

    expect(calls).toEqual({ run: 1, exists: 1, sleep: 0 })
  })

  test("retries an unpublished version after a delay", async () => {
    const calls = { run: 0, exists: 0 }
    const delays: number[] = []
    const err = new Error("registry unavailable")

    await NpmPublish.retry({
      name: "@kilocode/test",
      version: "1.0.0",
      run: async () => {
        calls.run++
        if (calls.run === 1) throw err
      },
      exists: async () => {
        calls.exists++
        return false
      },
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(calls).toEqual({ run: 2, exists: 1 })
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeGreaterThanOrEqual(10_000)
    expect(delays[0]).toBeLessThan(15_000)
  })

  test("accepts a version that becomes visible after a retry", async () => {
    const calls = { run: 0, exists: 0 }
    const delays: number[] = []
    const err = new Error("registry response lost")

    await NpmPublish.retry({
      name: "@kilocode/test",
      version: "1.0.0",
      run: async () => {
        calls.run++
        throw err
      },
      exists: async () => {
        calls.exists++
        return calls.exists === 2
      },
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(calls).toEqual({ run: 2, exists: 2 })
    expect(delays).toHaveLength(1)
  })

  test("preserves the error after all attempts fail", async () => {
    const calls = { run: 0, exists: 0 }
    const delays: number[] = []
    const err = new Error("permission denied")

    const failure = await NpmPublish.retry({
      name: "@kilocode/test",
      version: "1.0.0",
      run: async () => {
        calls.run++
        throw err
      },
      exists: async () => {
        calls.exists++
        return false
      },
      sleep: async (ms) => {
        delays.push(ms)
      },
    }).then(
      () => undefined,
      (error) => error,
    )

    expect(failure).toBe(err)
    expect(calls).toEqual({ run: 3, exists: 3 })
    expect(delays).toHaveLength(2)
    expect(delays[0]).toBeGreaterThanOrEqual(10_000)
    expect(delays[0]).toBeLessThan(15_000)
    expect(delays[1]).toBeGreaterThanOrEqual(20_000)
    expect(delays[1]).toBeLessThan(25_000)
  })
})
