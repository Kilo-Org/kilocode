import { describe, expect, it } from "bun:test"
import { createFrameQueue, streamMessage } from "../../webview-ui/src/context/frame-queue"

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("createFrameQueue", () => {
  it("applies every item pushed in the same frame in one drain, in order", async () => {
    const drains: number[][] = []
    const saved = globalThis.requestAnimationFrame
    let pending: FrameRequestCallback | undefined
    globalThis.requestAnimationFrame = (cb) => {
      pending = cb
      return 1
    }
    const queue = createFrameQueue<number>((items) => drains.push(items))
    queue.push(1)
    queue.push(2)
    queue.push(3)
    expect(drains).toEqual([])
    expect(queue.size).toBe(3)
    pending?.(0)
    expect(drains).toEqual([[1, 2, 3]])
    expect(queue.size).toBe(0)
    globalThis.requestAnimationFrame = saved
  })

  it("flush applies queued items immediately and drops the scheduled frame", async () => {
    const drains: string[][] = []
    const queue = createFrameQueue<string>((items) => drains.push(items))
    queue.push("a")
    queue.flush()
    expect(drains).toEqual([["a"]])
    await frame()
    await frame()
    expect(drains).toEqual([["a"]])
  })

  it("drains without animation frames when they are unavailable", async () => {
    const saved = globalThis.requestAnimationFrame
    // @ts-expect-error simulate a hidden webview with no frame callbacks
    globalThis.requestAnimationFrame = undefined
    const drains: number[][] = []
    const queue = createFrameQueue<number>((items) => drains.push(items))
    queue.push(7)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(drains).toEqual([[7]])
    globalThis.requestAnimationFrame = saved
  })
})

describe("createFrameQueue with a coalesce predicate", () => {
  it("applies non-coalesced items synchronously after flushing what is queued", () => {
    const drains: string[][] = []
    const queue = createFrameQueue<string>(
      (items) => drains.push(items),
      (item) => item.startsWith("delta"),
    )
    queue.push("delta-1")
    queue.push("delta-2")
    expect(drains).toEqual([])
    queue.push("sessionCreated")
    // Order is preserved: queued deltas land first, then the control message.
    expect(drains).toEqual([["delta-1", "delta-2"], ["sessionCreated"]])
    expect(queue.size).toBe(0)
  })
})

describe("streamMessage", () => {
  it("is the single stream set: session.tsx dispatches through it", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(import.meta.dir, "../../webview-ui/src/context/session.tsx"),
      "utf-8",
    )
    expect(src).toContain("if (!streamMessage(message)) return false")
  })

  it("only coalesces part deltas", () => {
    expect(streamMessage({ type: "partsUpdated", updates: [] } as never)).toBe(true)
    expect(streamMessage({ type: "sessionCreated" } as never)).toBe(false)
    expect(streamMessage({ type: "messagesLoaded" } as never)).toBe(false)
    expect(streamMessage({ type: "questionResolved" } as never)).toBe(false)
  })
})
