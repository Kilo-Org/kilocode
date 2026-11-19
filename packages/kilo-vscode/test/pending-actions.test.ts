import { describe, expect, test } from "bun:test"
import {
  pendingActions,
  pendingEditable,
  pendingRequest,
  promptInterrupt,
  sendMode,
  sendShortcuts,
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
  test("Stop and send resumes without cancelling a running compaction", () => {
    expect(promptInterrupt("ses_1")).toEqual({ sessionID: "ses_1", resume: true, steer: true })
  })
})
