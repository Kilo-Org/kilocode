import { describe, expect, test } from "bun:test"
import { pendingActions, sendMode, steerInterrupts } from "../webview-ui/src/v2/pending-actions"

const key = (input: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) => ({
  altKey: !!input.alt,
  ctrlKey: !!input.ctrl,
  metaKey: !!input.meta,
})

describe("sendMode", () => {
  test("an idle session always sends normally", () => {
    expect(sendMode(key({ alt: true }), false, true)).toBe("steer")
    expect(sendMode(key({ meta: true }), false, true)).toBe("steer")
    expect(sendMode(key({ ctrl: true }), false, false)).toBe("steer")
  })

  test("a running session steers, queues with Alt and sends now with the platform modifier", () => {
    expect(sendMode(key(), true, true)).toBe("steer")
    expect(sendMode(key({ alt: true }), true, true)).toBe("queue")
    expect(sendMode(key({ meta: true }), true, true)).toBe("now")
    expect(sendMode(key({ ctrl: true }), true, false)).toBe("now")
  })

  test("the other platform's modifier does not send now", () => {
    expect(sendMode(key({ ctrl: true }), true, true)).toBe("steer")
    expect(sendMode(key({ meta: true }), true, false)).toBe("steer")
  })
})

describe("pendingActions", () => {
  test("a queued prompt can be steered, edited or deleted", () => {
    expect(pendingActions("queued", true)).toEqual(["steer", "edit", "delete"])
  })

  test("a steer waiting for a step or a stopped run can be sent now", () => {
    expect(pendingActions("steering", true)).toEqual(["now", "queue", "edit", "delete"])
    expect(pendingActions("stranded", true)).toEqual(["now", "queue", "edit", "delete"])
  })

  test("a starting prompt cannot be sent now", () => {
    expect(pendingActions("starting", true)).toEqual(["queue", "edit", "delete"])
  })

  test("a prompt with attachments cannot be edited in the text composer", () => {
    expect(pendingActions("steering", false)).toEqual(["now", "queue", "delete"])
    expect(pendingActions("queued", false)).toEqual(["steer", "delete"])
  })
})

describe("steerInterrupts", () => {
  const tool = (status: string) => ({ type: "tool", state: { status } })

  test("a thinking or writing model is stopped so the steer reaches it now", () => {
    expect(steerInterrupts(undefined)).toBe(true)
    expect(steerInterrupts({ type: "user" })).toBe(true)
    expect(steerInterrupts({ type: "assistant", content: [{ type: "reasoning" }] })).toBe(true)
    expect(steerInterrupts({ type: "assistant", content: [{ type: "text" }, tool("streaming")] })).toBe(true)
    expect(steerInterrupts({ type: "assistant", content: [tool("completed")] })).toBe(true)
  })

  test("a running tool or compaction finishes before the steer is delivered", () => {
    expect(steerInterrupts({ type: "assistant", content: [tool("completed"), tool("running")] })).toBe(false)
    expect(steerInterrupts({ type: "compaction", status: "running" })).toBe(false)
    expect(steerInterrupts({ type: "compaction", status: "completed" })).toBe(true)
  })
})
