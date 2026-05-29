import { describe, expect, it } from "bun:test"
import {
  activeUserMessageID,
  messageTurns,
  partitionTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  visibleMessages,
} from "../../webview-ui/src/context/session-queue"
import type { Message, SessionStatusInfo } from "../../webview-ui/src/types/messages"

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

const layout = (messages: Message[], status: SessionStatusInfo, boundary?: string) => {
  const active = activeUserMessageID(messages, status)
  return partitionTurns(
    messageTurns(messages, boundary),
    new Set(active ? [active] : []),
    new Set(queuedUserMessageIDs(messages, status)),
  )
}

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

  it("queues loaded follow-ups after an active partial turn whose parent is outside the page", () => {
    const messages = [assistant("message_2", "message_1", { finish: "tool-calls" }), user("message_3")]

    expect(queuedUserMessageIDs(messages, { type: "busy" })).toEqual(["message_3"])
  })

  it("returns no queued messages while idle", () => {
    const messages = [user("message_1"), user("message_2")]

    expect(queuedUserMessageIDs(messages, { type: "idle" })).toEqual([])
  })
})

describe("partitionTurns", () => {
  it("renders the streaming turn outside virtual history", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      user("message_3"),
      assistant("message_4", "message_3", { finish: "tool-calls" }),
    ]
    const result = layout(messages, { type: "busy" })

    expect(result.virtual.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_3"])
    expect(result.queued).toEqual([])
  })

  it("renders a streaming partial turn directly when its parent is outside the loaded page", () => {
    const result = layout([assistant("message_2", "message_1", { finish: "tool-calls" })], { type: "busy" })

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued).toEqual([])
  })

  it("keeps an active partial turn direct when later loaded prompts are queued", () => {
    const result = layout([assistant("message_2", "message_1", { finish: "tool-calls" }), user("message_3")], {
      type: "busy",
    })

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_3"])
  })

  it("keeps an active partial direct when its update arrives after a queued prompt", () => {
    const result = layout([user("message_3"), assistant("message_2", "message_1", { finish: "tool-calls" })], {
      type: "busy",
    })

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_3"])
  })

  it("keeps queued prompts after the directly rendered active turn", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "tool-calls" }),
      user("message_3"),
      user("message_4"),
    ]
    const result = layout(messages, { type: "busy" })

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_3", "message_4"])
  })

  it("renders the first pending user turn directly before assistant output exists", () => {
    const result = layout([user("message_1"), user("message_2")], { type: "busy" })

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_2"])
  })

  it("moves a completed turn into history when the next queued turn becomes active at the bottom", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      user("message_3"),
      user("message_4"),
    ]
    const result = layout(messages, { type: "busy" })

    expect(result.virtual.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_3"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_4"])
  })

  it("retains completed and newly active tail turns directly during a paused queued handoff", () => {
    const turns = messageTurns([
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      user("message_3"),
      user("message_4"),
    ])
    const result = partitionTurns(turns, new Set(["message_1", "message_3"]), new Set(["message_4"]))

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1", "message_3"])
    expect(result.queued.map((turn) => turn.user.id)).toEqual(["message_4"])
  })

  it("returns completed idle turns to virtual history", () => {
    const result = layout([user("message_1"), assistant("message_2", "message_1", { finish: "stop" })], {
      type: "idle",
    })

    expect(result.virtual.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.direct).toEqual([])
    expect(result.queued).toEqual([])
  })

  it("can retain a completed tail directly while its reading position is paused", () => {
    const turns = messageTurns([user("message_1"), assistant("message_2", "message_1", { finish: "stop" })])
    const result = partitionTurns(turns, new Set(["message_1"]), new Set())

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.queued).toEqual([])
  })

  it("preserves order when a retained turn has later visible prompts", () => {
    const turns = messageTurns([user("message_1"), user("message_2")])
    const result = partitionTurns(turns, new Set(["message_1"]), new Set())

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1", "message_2"])
    expect(result.queued).toEqual([])
  })

  it("keeps a paused completed turn direct when idle leaves a later prompt visible", () => {
    const turns = messageTurns([
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      user("message_3"),
    ])
    const result = partitionTurns(turns, new Set(["message_1"]), new Set())

    expect(result.virtual).toEqual([])
    expect(result.direct.map((turn) => turn.user.id)).toEqual(["message_1", "message_3"])
    expect(result.queued).toEqual([])
  })

  it("does not render an active turn hidden by a revert boundary", () => {
    const messages = [user("message_1"), assistant("message_2", "message_1", { finish: "stop" }), user("message_3")]
    const result = layout(messages, { type: "busy" }, "message_3")

    expect(result.virtual.map((turn) => turn.user.id)).toEqual(["message_1"])
    expect(result.direct).toEqual([])
    expect(result.queued).toEqual([])
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

  it("keeps a parented assistant partial separate when its update follows newer loaded users", () => {
    const turns = messageTurns([user("message_3"), assistant("message_2", "message_1")])

    expect(
      turns.map((turn) => ({ id: turn.id, partial: turn.partial, assistant: turn.assistant.map((msg) => msg.id) })),
    ).toEqual([
      { id: "message_1", partial: true, assistant: ["message_2"] },
      { id: "message_3", partial: undefined, assistant: [] },
    ])
  })

  it("stops at the revert boundary user turn", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      user("message_3"),
      assistant("message_4", "message_3"),
    ]

    expect(messageTurns(messages, "message_3").map((turn) => turn.user.id)).toEqual(["message_1"])
  })
})

describe("visibleMessages", () => {
  it("flattens only turns before the revert boundary", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      user("message_3"),
      assistant("message_4", "message_3"),
    ]

    expect(visibleMessages(messages, "message_3").map((msg) => msg.id)).toEqual(["message_1", "message_2"])
  })

  it("keeps leading partial assistant output", () => {
    const messages = [assistant("message_2", "message_1"), user("message_3")]

    expect(visibleMessages(messages).map((msg) => msg.id)).toEqual(["message_2", "message_3"])
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

  it("uses a streaming partial turn whose parent is outside the loaded page", () => {
    const messages = [assistant("message_2", "message_1", { finish: "tool-calls" })]

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
