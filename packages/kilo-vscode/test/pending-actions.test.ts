import { describe, expect, test } from "bun:test"
import {
  intentMode,
  pendingActions,
  pendingEditable,
  pendingRequest,
  promptInterrupt,
  sendMode,
  sendShortcuts,
  steerInterrupts,
} from "../webview-ui/src/v2/pending-actions"

const key = (input: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) => ({
  altKey: !!input.alt,
  ctrlKey: !!input.ctrl,
  metaKey: !!input.meta,
})

describe("sendMode", () => {
  test("an idle session always sends normally", () => {
    expect(sendMode(key({ alt: true }), false, "steer", true)).toBe("steer")
    expect(sendMode(key({ meta: true }), false, "steer", true)).toBe("steer")
    expect(sendMode(key({ ctrl: true }), false, "steer", false)).toBe("steer")
  })

  test("a running session steers, queues with Alt and sends now with the platform modifier", () => {
    expect(sendMode(key(), true, "steer", true)).toBe("steer")
    expect(sendMode(key({ alt: true }), true, "steer", true)).toBe("queue")
    expect(sendMode(key({ meta: true }), true, "steer", true)).toBe("now")
    expect(sendMode(key({ ctrl: true }), true, "steer", false)).toBe("now")
  })

  test("with queue preferred, Enter queues and Alt steers", () => {
    expect(sendMode(key(), true, "queue", true)).toBe("queue")
    expect(sendMode(key({ alt: true }), true, "queue", true)).toBe("steer")
    expect(sendMode(key({ meta: true }), true, "queue", true)).toBe("now")
    expect(sendMode(key({ alt: true }), false, "queue", true)).toBe("steer")
  })

  test("the shortcuts follow the preferred delivery", () => {
    expect(sendShortcuts("steer", true)).toEqual({ steer: "↵", queue: "⌥↵", now: "⌘↵" })
    expect(sendShortcuts("queue", false)).toEqual({ steer: "Alt+Enter", queue: "Enter", now: "Ctrl+Enter" })
  })

  test("the other platform's modifier does not send now", () => {
    expect(sendMode(key({ ctrl: true }), true, "steer", true)).toBe("steer")
    expect(sendMode(key({ meta: true }), true, "steer", false)).toBe("steer")
  })
})

describe("intentMode", () => {
  test("a plain click sends the way Enter does and an Option-click the way ⌥↵ does", () => {
    expect(intentMode("enter", true, "steer")).toBe("steer")
    expect(intentMode("alternate", true, "steer")).toBe("queue")
    expect(intentMode("enter", true, "queue")).toBe("queue")
    expect(intentMode("alternate", true, "queue")).toBe("steer")
  })

  test("an idle session sends normally from either click", () => {
    expect(intentMode("enter", false, "queue")).toBe("steer")
    expect(intentMode("alternate", false, "steer")).toBe("steer")
  })

  test("a click never stops the run", () => {
    expect(intentMode("enter", true, "steer")).not.toBe("now")
    expect(intentMode("alternate", true, "steer")).not.toBe("now")
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
  const none = new Set<string>()
  const user = { id: "u1", type: "user" }
  const step = (...content: { type: string; state?: { status: string } }[]) => ({
    id: "a1",
    type: "assistant",
    content,
  })

  test("a thinking or writing model is stopped so the steer reaches it now", () => {
    expect(steerInterrupts([], none)).toBe(true)
    expect(steerInterrupts([user], none)).toBe(true)
    expect(steerInterrupts([user, step({ type: "reasoning" })], none)).toBe(true)
    expect(steerInterrupts([user, step({ type: "text" }, tool("streaming"))], none)).toBe(true)
    expect(steerInterrupts([user, step(tool("completed"))], none)).toBe(true)
  })

  test("a running tool or compaction finishes before the steer is delivered", () => {
    expect(steerInterrupts([user, step(tool("completed"), tool("running"))], none)).toBe(false)
    expect(steerInterrupts([{ id: "c1", type: "compaction", status: "running" }], none)).toBe(false)
    expect(steerInterrupts([{ id: "c1", type: "compaction", status: "completed" }], none)).toBe(true)
  })

  test("input that waits for delivery does not hide a running tool", () => {
    const queued = { id: "q1", type: "user" }
    expect(steerInterrupts([user, step(tool("running")), queued], new Set(["q1"]))).toBe(false)
  })

  test("a trailing notification or instruction update does not hide a running tool", () => {
    expect(steerInterrupts([user, step(tool("running")), { id: "s1", type: "synthetic" }], none)).toBe(false)
    expect(steerInterrupts([user, step(tool("running")), { id: "s2", type: "system" }], none)).toBe(false)
  })
})

describe("pendingEditable", () => {
  test("plain text can go back to the composer", () => {
    expect(pendingEditable({})).toBe(true)
  })

  test("attachments the composer cannot restore keep Edit hidden", () => {
    expect(pendingEditable({ files: [{}] })).toBe(false)
    expect(pendingEditable({ agents: [{}] })).toBe(false)
    expect(pendingEditable({ skills: [{}] })).toBe(false)
  })
})

describe("pendingRequest", () => {
  test("send now stops the turn first", () => {
    expect(pendingRequest("now")).toEqual({ type: "interrupt" })
  })

  test("steer and queue only change delivery", () => {
    expect(pendingRequest("steer")).toEqual({ type: "delivery", delivery: "steer" })
    expect(pendingRequest("queue")).toEqual({ type: "delivery", delivery: "queue" })
  })

  test("edit and delete cancel the pending row", () => {
    expect(pendingRequest("edit")).toEqual({ type: "cancel" })
    expect(pendingRequest("delete")).toEqual({ type: "cancel" })
  })
})

describe("promptInterrupt", () => {
  test("a prompt-sending action steers and resumes, never carrying a bare stop", () => {
    expect(promptInterrupt("ses_1")).toEqual({ sessionID: "ses_1", resume: true, steer: true })
  })
})
