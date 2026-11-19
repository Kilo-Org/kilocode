import { expect, test } from "bun:test"
import { fetchRetry } from "../script/kilocode/nono"

const answer = (status: number) => new Response(null, { status })

test("retries a transient network failure", async () => {
  let calls = 0
  const response = await fetchRetry("https://example.invalid/nono", async () => {
    calls += 1
    if (calls < 3) throw new TypeError("getaddrinfo ENOTFOUND github.com")
    return answer(200)
  })
  expect(response.status).toBe(200)
  expect(calls).toBe(3)
})

test("retries a retryable status and returns the third answer", async () => {
  const statuses = [429, 503, 502]
  let calls = 0
  const response = await fetchRetry("https://example.invalid/nono", async () => {
    calls += 1
    return answer(statuses[calls - 1] ?? 500)
  })
  expect(response.status).toBe(502)
  expect(calls).toBe(3)
})

test("does not retry a missing asset", async () => {
  let calls = 0
  const response = await fetchRetry("https://example.invalid/nono", async () => {
    calls += 1
    return answer(404)
  })
  expect(response.status).toBe(404)
  expect(calls).toBe(1)
})

test("throws the last network failure after three attempts", async () => {
  let calls = 0
  const failure = await fetchRetry("https://example.invalid/nono", async () => {
    calls += 1
    throw new TypeError("offline")
  }).catch((cause) => cause)
  expect(calls).toBe(3)
  expect(String(failure)).toContain("offline")
}, 10000)
