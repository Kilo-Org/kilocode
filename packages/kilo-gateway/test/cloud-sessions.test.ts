import { describe, expect, test } from "bun:test"
import { fetchCloudSession, fetchCloudSessionForImport } from "../src/cloud-sessions"

async function expectStalledFetchToTimeOut(run: () => Promise<unknown>) {
  const fetch = globalThis.fetch
  const timeout = AbortSignal.timeout
  let delay: number | undefined

  AbortSignal.timeout = (ms) => {
    delay = ms
    const controller = new AbortController()
    queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
    return controller.signal
  }
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    })) as typeof globalThis.fetch

  try {
    const outcome = await Promise.race([
      run().then(
        () => "resolved" as const,
        (err) => {
          if (err instanceof DOMException && err.name === "TimeoutError") return "timed-out" as const
          throw err
        },
      ),
      Bun.sleep(50).then(() => "still-pending" as const),
    ])

    expect(outcome).toBe("timed-out")
    expect(delay).toBe(30_000)
  } finally {
    globalThis.fetch = fetch
    AbortSignal.timeout = timeout
  }
}

describe("cloud session export requests", () => {
  test("times out a stalled preview request", async () => {
    await expectStalledFetchToTimeOut(() => fetchCloudSession("token", "session-id"))
  })

  test("times out a stalled import request", async () => {
    await expectStalledFetchToTimeOut(() => fetchCloudSessionForImport("token", "session-id"))
  })
})
