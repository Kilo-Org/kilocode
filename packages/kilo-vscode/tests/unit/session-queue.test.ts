import { describe, expect, it } from "bun:test"
import {
  activeUserMessageID,
  messageTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
} from "../../webview-ui/src/context/session-queue"
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

describe("queuedUserMessageIDs", () => {
  it("keeps follow-ups queued before the first assistant exists", () => {
    const messages = [user("message_1"), user("message_2")]

    expect(queuedUserMessageIDs(messages, { type: "busy" })).toEqual(["message_2"])
  })

  it("keeps follow-ups queued after a pending assistant parent", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "tool-calls" }),
      user("message_3"),
    ]

    expect(queuedUserMessageIDs(messages, { type: "busy" })).toEqual(["message_3"])
  })

  it("keeps only later follow-ups queued after a terminal assistant", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      user("message_3"),
      user("message_4"),
    ]

    expect(queuedUserMessageIDs(messages, { type: "busy" })).toEqual(["message_4"])
  })

  it("keeps all follow-ups queued when the active assistant arrives after them", () => {
    const messages = [
      user("message_1"),
      user("message_3"),
      user("message_4"),
      assistant("message_2", "message_1", { finish: "tool-calls" }),
    ]

    expect(queuedUserMessageIDs(messages, { type: "busy" })).toEqual(["message_3", "message_4"])
  })

  it("returns no queued messages while idle", () => {
    const messages = [user("message_1"), user("message_2")]

    expect(queuedUserMessageIDs(messages, { type: "idle" })).toEqual([])
  })
})

describe("messageTurns", () => {
  it("attaches assistant output to its parent turn when queued users are newer", () => {
    const messages = [
      user("message_1"),
      user("message_3"),
      user("message_4"),
      assistant("message_2", "message_1", { finish: "tool-calls" }),
    ]

    expect(
      messageTurns(messages).map((turn) => ({
        user: turn.user.id,
        assistant: turn.assistant.map((msg) => msg.id),
      })),
    ).toEqual([
      { user: "message_1", assistant: ["message_2"] },
      { user: "message_3", assistant: [] },
      { user: "message_4", assistant: [] },
    ])
  })

  it("surfaces leading assistant output as partial turns grouped by parent", () => {
    const messages = [
      assistant("message_2", "message_1"),
      assistant("message_4", "message_3"),
      assistant("message_5", "message_3"),
      user("message_6"),
    ]
    const turns = messageTurns(messages)

    expect(
      turns.map((turn) => ({ id: turn.id, partial: turn.partial, assistant: turn.assistant.map((msg) => msg.id) })),
    ).toEqual([
      { id: "message_1", partial: true, assistant: ["message_2"] },
      { id: "message_3", partial: true, assistant: ["message_4", "message_5"] },
      { id: "message_6", partial: undefined, assistant: [] },
    ])
  })
})

describe("stableMessageTurns", () => {
  it("keeps existing turn identities stable when older turns are prepended", () => {
    const u1 = user("message_1")
    const a2 = assistant("message_2", "message_1")
    const u3 = user("message_3")
    const prev = messageTurns([u1, a2, u3])
    const next = stableMessageTurns(messageTurns([user("message_0"), u1, a2, u3]), prev)

    expect(next[1]).toBe(prev[0])
    expect(next[2]).toBe(prev[1])
  })

  it("replaces a turn identity when its assistant messages change", () => {
    const u1 = user("message_1")
    const a2 = assistant("message_2", "message_1")
    const prev = messageTurns([u1, a2])
    const next = stableMessageTurns(messageTurns([u1, a2, assistant("message_3", "message_1")]), prev)

    expect(next[0]).not.toBe(prev[0])
    expect(next[0]?.assistant.map((msg) => msg.id)).toEqual(["message_2", "message_3"])
  })

  it("keeps partial turn identities stable while their assistant messages are unchanged", () => {
    const a2 = assistant("message_2", "message_1")
    const a3 = assistant("message_3", "message_1")
    const prev = messageTurns([a2, a3])
    const next = stableMessageTurns(messageTurns([a2, a3, user("message_4")]), prev)

    expect(next[0]).toBe(prev[0])
  })
})

describe("activeUserMessageID", () => {
  it("uses the first pending user before the first assistant exists", () => {
    const messages = [user("message_1"), user("message_2")]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_1")
  })

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

  it("ignores aborted assistants without completed timestamps", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { error: { name: "MessageAbortedError" } }),
      user("message_3"),
    ]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_3")
  })
})
