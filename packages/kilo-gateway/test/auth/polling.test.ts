import { expect, test } from "bun:test"
import { poll } from "../../src/auth/polling.js"
import type { PollResult } from "../../src/types.js"

const options = { interval: 1, maxAttempts: 5 }

test("poll keeps polling after transient thrown errors and returns data", async () => {
  let calls = 0
  const pollFn = (): Promise<PollResult<string>> => {
    calls++
    if (calls < 3) throw new Error(`transient failure ${calls}`)
    return Promise.resolve({ continue: false, data: "token" })
  }

  await expect(poll<string>({ ...options, pollFn })).resolves.toBe("token")
  expect(calls).toBe(3)
})

test("poll throws the last poll error when attempts run out", async () => {
  let calls = 0
  const pollFn = (): Promise<PollResult<string>> => {
    calls++
    return Promise.reject(new Error("gateway down"))
  }

  await expect(poll<string>({ interval: 1, maxAttempts: 3, pollFn })).rejects.toThrow("gateway down")
  expect(calls).toBe(3)
})

test("poll still stops immediately on a terminal result error", async () => {
  let calls = 0
  const pollFn = (): Promise<PollResult<string>> => {
    calls++
    return Promise.resolve({ continue: false, error: new Error("authorization denied") })
  }

  await expect(poll<string>({ ...options, pollFn })).rejects.toThrow("authorization denied")
  expect(calls).toBe(1)
})

test("poll reports a timeout when attempts run out without any thrown error", async () => {
  const pollFn = (): Promise<PollResult<string>> => Promise.resolve({ continue: true })

  await expect(poll<string>({ interval: 1, maxAttempts: 2, pollFn })).rejects.toThrow(
    "Polling timeout: Maximum attempts reached",
  )
})
