import { describe, expect, it } from "bun:test"
import { activeUserMessageID } from "../../webview-ui/src/context/session-queue"
import type { Message } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string): Message => ({ ...base, id, role: "user" })

const assistant = (id: string, parentID: string, opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  parentID,
  role: "assistant",
  ...opts,
})

describe("activeUserMessageID", () => {
  it("ignores terminal assistant updates without completed timestamps", () => {
    const messages = [user("message_1"), assistant("message_2", "message_1", { finish: "stop" }), user("message_3")]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_3")
  })

  it("keeps tool-call assistants active until their follow-up finishes", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "tool-calls" }),
      user("message_3"),
    ]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_1")
  })

  it("keeps unknown assistants active until cleanup finishes", () => {
    const messages = [user("message_1"), assistant("message_2", "message_1", { finish: "unknown" }), user("message_3")]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_1")
  })
})
