import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { MessageID, SessionID } from "../../src/session/schema"

function slot(sessionID: SessionID, id: string, calls: string[], gate?: Promise<void>) {
  return Effect.runPromise(
    KiloSessionPromptQueue.enqueue(
      sessionID,
      MessageID.make(id),
      Effect.promise(async () => {
        calls.push(id)
        await gate
        return id
      }),
      Effect.succeed(`${id}-cancelled`),
    ),
  )
}

async function setup(name: string) {
  const sessionID = SessionID.make(name)
  const calls: string[] = []
  const active = Promise.withResolvers<void>()
  const first = slot(sessionID, "msg_a", calls, active.promise)
  while (!calls.includes("msg_a")) await Bun.sleep(1)
  return { sessionID, calls, active, first }
}

describe("KiloSessionPromptQueue.promote", () => {
  test("runs the promoted message ahead of earlier queued messages", async () => {
    const ctx = await setup("session_promote_order")
    const b = slot(ctx.sessionID, "msg_b", ctx.calls)
    const c = slot(ctx.sessionID, "msg_c", ctx.calls)
    const d = slot(ctx.sessionID, "msg_d", ctx.calls)

    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_c")))).toBe(true)
    expect(KiloSessionPromptQueue.snapshot(ctx.sessionID)).toEqual(["msg_c", "msg_b", "msg_d"].map((id) => MessageID.make(id)))
    ctx.active.resolve()

    expect(await Promise.all([ctx.first, b, c, d])).toEqual(["msg_a", "msg_b", "msg_c", "msg_d"])
    expect(ctx.calls).toEqual(["msg_a", "msg_c", "msg_b", "msg_d"])
    await Bun.sleep(0)
    expect(KiloSessionPromptQueue._hasInternalState(ctx.sessionID)).toBe(false)
  })

  test("promoting the last message still drains the queue and clears state", async () => {
    const ctx = await setup("session_promote_last")
    const b = slot(ctx.sessionID, "msg_b", ctx.calls)
    const c = slot(ctx.sessionID, "msg_c", ctx.calls)

    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_c")))).toBe(true)
    ctx.active.resolve()

    expect(await Promise.all([ctx.first, b, c])).toEqual(["msg_a", "msg_b", "msg_c"])
    expect(ctx.calls).toEqual(["msg_a", "msg_c", "msg_b"])
    await Bun.sleep(0)
    expect(KiloSessionPromptQueue._hasInternalState(ctx.sessionID)).toBe(false)
  })

  test("the cancel that follows a promote keeps the queue", async () => {
    const ctx = await setup("session_promote_keep")
    const b = slot(ctx.sessionID, "msg_b", ctx.calls)
    const c = slot(ctx.sessionID, "msg_c", ctx.calls)

    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_c")))).toBe(true)
    await Effect.runPromise(KiloSessionPromptQueue.cancel(ctx.sessionID))
    ctx.active.resolve()

    expect(await Promise.all([ctx.first, b, c])).toEqual(["msg_a", "msg_b", "msg_c"])
    expect(ctx.calls).toEqual(["msg_a", "msg_c", "msg_b"])
  })

  test("a later plain cancel still cancels the whole queue", async () => {
    const ctx = await setup("session_promote_then_cancel")
    const b = slot(ctx.sessionID, "msg_b", ctx.calls)

    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_b")))).toBe(true)
    KiloSessionPromptQueue.release(ctx.sessionID)
    await Effect.runPromise(KiloSessionPromptQueue.cancel(ctx.sessionID))
    ctx.active.resolve()

    expect(await b).toBe("msg_b-cancelled")
    expect(ctx.calls).toEqual(["msg_a"])
  })

  test("returns false for the running message and unknown messages", async () => {
    const ctx = await setup("session_promote_missing")
    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_a")))).toBe(false)
    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_x")))).toBe(false)
    ctx.active.resolve()
    expect(await ctx.first).toBe("msg_a")
    expect(KiloSessionPromptQueue._hasInternalState(ctx.sessionID)).toBe(false)
  })

  test("dropping the promoted message falls back to FIFO", async () => {
    const ctx = await setup("session_promote_drop")
    const b = slot(ctx.sessionID, "msg_b", ctx.calls)
    const c = slot(ctx.sessionID, "msg_c", ctx.calls)

    expect(await Effect.runPromise(KiloSessionPromptQueue.promote(ctx.sessionID, MessageID.make("msg_c")))).toBe(true)
    expect(await Effect.runPromise(KiloSessionPromptQueue.drop(ctx.sessionID, MessageID.make("msg_c")))).toBe(true)
    ctx.active.resolve()

    expect(await Promise.all([ctx.first, b, c])).toEqual(["msg_a", "msg_b", "msg_c-cancelled"])
    expect(ctx.calls).toEqual(["msg_a", "msg_b"])
    await Bun.sleep(0)
    expect(KiloSessionPromptQueue._hasInternalState(ctx.sessionID)).toBe(false)
  })
})
