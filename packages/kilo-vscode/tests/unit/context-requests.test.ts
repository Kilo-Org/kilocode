import { describe, expect, it, spyOn } from "bun:test"
import { createContextRequests } from "../../webview-ui/src/hooks/context-requests"

function ignored() {
  throw new Error("Unexpected settlement")
}

describe("context requests", () => {
  it("registers before synchronous replies and keeps IDs per instance", async () => {
    const first = createContextRequests("context", 1_000, "Timed out")
    const second = createContextRequests("context", 1_000, "Timed out")
    const ids: string[] = []

    for (const ctx of [first, first, second]) {
      expect(ctx.pending()).toBe(false)
      const result = ctx.request((id) => {
        ids.push(id)
        expect(ctx.pending()).toBe(true)
        ctx.settle(id, (req) => {
          expect(ctx.pending()).toBe(false)
          req.resolve(id)
        })
      })
      expect(ctx.pending()).toBe(false)
      await expect(result).resolves.toBe(ids.at(-1))
    }
    expect(ids).toEqual(["context-1", "context-2", "context-1"])
  })

  it("settles out of order and ignores unknown and late IDs", async () => {
    const ctx = createContextRequests("context", 1_000, "Timed out")
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const one = ctx.request(first.resolve)
    const two = ctx.request(second.resolve)

    ctx.settle("unknown", ignored)
    expect(ctx.pending()).toBe(true)
    ctx.settle(await second.promise, (req) => req.resolve("second"))
    await expect(two).resolves.toBe("second")
    expect(ctx.pending()).toBe(true)
    ctx.settle(await second.promise, ignored)
    expect(ctx.pending()).toBe(true)
    ctx.settle(await first.promise, (req) => req.resolve("first"))
    await expect(one).resolves.toBe("first")
    expect(ctx.pending()).toBe(false)
    ctx.settle(await first.promise, ignored)
    expect(ctx.pending()).toBe(false)
  })

  it("rejects a matching request and ignores a late reply", async () => {
    const ctx = createContextRequests("context", 1_000, "Timed out")
    const sent = Promise.withResolvers<string>()
    const result = ctx.request(sent.resolve)
    const err = new Error("No context available")

    ctx.settle(await sent.promise, (req) => req.reject(err))
    await expect(result).rejects.toBe(err)
    expect(ctx.pending()).toBe(false)
    ctx.settle(await sent.promise, ignored)
  })

  it("rejects after a short real timeout and ignores the late reply", async () => {
    const ctx = createContextRequests("context", 5, "Context timed out")
    const sent = Promise.withResolvers<string>()
    const result = ctx.request(sent.resolve)

    expect(ctx.pending()).toBe(true)
    await expect(result).rejects.toThrow("Context timed out")
    expect(ctx.pending()).toBe(false)
    ctx.settle(await sent.promise, ignored)
  })

  it.each([undefined, true])("clears timers on disposal with reset=%s", async (reset) => {
    const ctx = createContextRequests("context", 1_000, "Timed out")
    const timers = spyOn(globalThis, "setTimeout")
    const clear = spyOn(globalThis, "clearTimeout")
    try {
      const first = ctx.request(() => {})
      const second = ctx.request(() => {})
      const done = Promise.allSettled([first, second])
      ctx.dispose("Disposed", reset)

      expect(timers).toHaveBeenCalledTimes(2)
      expect(clear).toHaveBeenCalledTimes(2)
      for (const result of timers.mock.results) expect(clear).toHaveBeenCalledWith(result.value)
      expect(ctx.pending()).toBe(reset !== true)
      await expect(done).resolves.toEqual([
        { status: "rejected", reason: new Error("Disposed") },
        { status: "rejected", reason: new Error("Disposed") },
      ])
      ctx.settle("context-1", ignored)
      ctx.settle("context-2", ignored)
      expect(ctx.pending()).toBe(reset !== true)
      ctx.dispose("Again", true)
      expect(ctx.pending()).toBe(false)
      expect(clear).toHaveBeenCalledTimes(2)
    } finally {
      ctx.dispose("Cleanup", true)
      timers.mockRestore()
      clear.mockRestore()
    }
  })

  it("keeps the failed send pending until disposal without losing existing requests", async () => {
    const ctx = createContextRequests("context", 1_000, "Timed out")
    const sent = Promise.withResolvers<string>()
    const existing = ctx.request(sent.resolve)
    const err = new Error("Send failed")
    const failed = ctx.request(() => {
      throw err
    })

    await expect(failed).rejects.toBe(err)
    expect(ctx.pending()).toBe(true)
    ctx.settle(await sent.promise, (req) => req.resolve("existing"))
    await expect(existing).resolves.toBe("existing")
    expect(ctx.pending()).toBe(true)
    ctx.dispose("Disposed", true)
    expect(ctx.pending()).toBe(false)
    ctx.settle("context-2", ignored)
  })
})
