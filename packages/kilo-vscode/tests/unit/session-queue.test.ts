import { describe, expect, it } from "bun:test"
import {
  activeUserMessageID,
  messageTurns,
  partitionTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  visibleMessages,
  visibleParts,
  type RevertBoundary,
} from "../../webview-ui/src/context/session-queue"
import type { Message, Part, SessionStatusInfo } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string): Message => ({ ...base, id, role: "user" })

const compact = (id: string): Message => ({
  ...user(id),
  parts: [{ id: `part_${id}`, sessionID: base.sessionID, messageID: id, type: "compaction", auto: false }],
})

const assistant = (id: string, parentID: string, opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  parentID,
  role: "assistant",
  ...opts,
})

const part = (id: string, messageID: string): Part => ({ id, messageID, type: "text", text: id })

const layout = (messages: Message[], status: SessionStatusInfo, revert?: RevertBoundary) => {
  const active = activeUserMessageID(messages, status)
  return partitionTurns(
    messageTurns(messages, revert),
    new Set(active ? [active] : []),
    new Set(queuedUserMessageIDs(messages, status)),
  )
}

const expectLayout = (
  messages: Message[],
  status: SessionStatusInfo,
  expected: { virtual: string[]; direct: string[]; queued: string[] },
) => {
  const result = layout(messages, status)
  expect({
    virtual: result.virtual.map((turn) => turn.user.id),
    direct: result.direct.map((turn) => turn.user.id),
    queued: result.queued.map((turn) => turn.user.id),
  }).toEqual(expected)
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

  it("keeps completed resumable assistants direct while the session is active", () => {
    const messages = (finish: string) => [
      user("message_1"),
      assistant("message_2", "message_1", { finish, time: { created: 1, completed: 2 } }),
      user("message_3"),
    ]
    const expected = { virtual: [], direct: ["message_1"], queued: ["message_3"] }

    expectLayout(messages("tool-calls"), { type: "busy" }, expected)
    expectLayout(messages("unknown"), { type: "busy" }, expected)
    expectLayout(messages("tool-calls"), { type: "retry", attempt: 1, message: "retrying", next: 2 }, expected)
    expectLayout(messages("tool-calls"), { type: "offline", message: "offline" }, expected)
  })

  it("does not retain a completed tool-call assistant with an error", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", {
        finish: "tool-calls",
        time: { created: 1, completed: 2 },
        error: { name: "MessageAbortedError" },
      }),
      user("message_3"),
    ]

    expectLayout(messages, { type: "busy" }, { virtual: ["message_1"], direct: ["message_3"], queued: [] })
  })

  it("does not revive a completed tool-call step behind an errored assistant", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "tool-calls", time: { created: 1, completed: 2 } }),
      assistant("message_3", "message_1", { error: { name: "MessageAbortedError" } }),
      user("message_4"),
    ]

    expectLayout(messages, { type: "busy" }, { virtual: ["message_1"], direct: ["message_4"], queued: [] })
  })

  it("does not revive completed resumable steps behind a terminal assistant", () => {
    const messages = (finish: string) => [
      user("message_1"),
      assistant("message_2", "message_1", { finish, time: { created: 1, completed: 2 } }),
      assistant("message_3", "message_1", { finish: "stop", time: { created: 3, completed: 4 } }),
      user("message_4"),
    ]
    const expected = { virtual: ["message_1"], direct: ["message_4"], queued: [] }

    expectLayout(messages("tool-calls"), { type: "busy" }, expected)
    expectLayout(messages("unknown"), { type: "busy" }, expected)
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
    const result = layout(messages, { type: "busy" }, { messageID: "message_3" })

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

  it("keeps resumed replies after a persisted compaction turn", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      compact("message_3"),
      assistant("message_4", "message_3", { summary: true, finish: "stop" }),
      assistant("message_5", "message_1", { finish: "stop" }),
    ]

    expect(
      messageTurns(messages).map((turn) => ({
        user: turn.user.id,
        assistant: turn.assistant.map((msg) => msg.id),
      })),
    ).toEqual([
      { user: "message_1", assistant: ["message_2"] },
      { user: "message_3", assistant: ["message_4", "message_5"] },
    ])
  })

  it("detects persisted compaction parts through the lazy lookup", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      user("message_3"),
      assistant("message_4", "message_3", { summary: true, finish: "stop" }),
      assistant("message_5", "message_1", { finish: "stop" }),
    ]

    expect(
      visibleMessages(messages, undefined, (msg) => (msg.id === "message_3" ? compact(msg.id).parts : msg.parts)).map(
        (msg) => msg.id,
      ),
    ).toEqual(["message_1", "message_2", "message_3", "message_4", "message_5"])
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

    expect(messageTurns(messages, { messageID: "message_3" }).map((turn) => turn.user.id)).toEqual(["message_1"])
  })

  it("keeps the part-boundary assistant and hides later provider errors", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      assistant("message_3", "message_1", { error: { name: "ProviderError" } }),
      assistant("message_4", "message_1", { error: { name: "ProviderError" } }),
    ]
    const turns = messageTurns(messages, { messageID: "message_2", partID: "part_2" })

    expect(turns).toHaveLength(1)
    expect(turns[0]?.assistant.map((msg) => msg.id)).toEqual(["message_2"])
  })

  it("applies assistant boundaries by id when messages arrive out of order", () => {
    const messages = [
      user("message_1"),
      assistant("message_4", "message_1", { error: { name: "ProviderError" } }),
      assistant("message_2", "message_1"),
    ]
    const turns = messageTurns(messages, { messageID: "message_2", partID: "part_2" })

    expect(turns[0]?.assistant.map((msg) => msg.id)).toEqual(["message_2"])
  })
})

describe("visibleParts", () => {
  it("keeps only parts before the active part boundary", () => {
    const parts = [part("part_1", "message_2"), part("part_2", "message_2"), part("part_3", "message_2")]

    expect(visibleParts("message_2", parts, { messageID: "message_2", partID: "part_2" })).toEqual([parts[0]])
  })

  it("fails closed when the boundary part is unavailable", () => {
    const parts = [part("part_1", "message_2")]

    expect(visibleParts("message_2", parts, { messageID: "message_2", partID: "part_missing" })).toEqual([])
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

    expect(visibleMessages(messages, { messageID: "message_3" }).map((msg) => msg.id)).toEqual([
      "message_1",
      "message_2",
    ])
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

  it("maps resumed post-compaction tool calls to the compaction turn", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      compact("message_3"),
      assistant("message_4", "message_3", { summary: true, finish: "stop" }),
      assistant("message_5", "message_1", { finish: "tool-calls" }),
      user("message_6"),
    ]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_3")
    expectLayout(messages, { type: "busy" }, { virtual: ["message_1"], direct: ["message_3"], queued: ["message_6"] })
  })

  it("uses lazy compaction parts when mapping resumed tool calls", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1"),
      user("message_3"),
      assistant("message_4", "message_3", { summary: true, finish: "stop" }),
      assistant("message_5", "message_1", { finish: "tool-calls" }),
    ]

    expect(
      activeUserMessageID(messages, { type: "busy" }, (msg) =>
        msg.id === "message_3" ? compact(msg.id).parts : msg.parts,
      ),
    ).toBe("message_3")
  })

  it("advances beyond a completed post-compaction reply", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "stop" }),
      compact("message_3"),
      assistant("message_4", "message_3", { summary: true, finish: "stop" }),
      assistant("message_5", "message_1", { finish: "stop" }),
      user("message_6"),
    ]

    expect(activeUserMessageID(messages, { type: "busy" })).toBe("message_6")
  })

  it("ignores completed tool-call assistants after the session becomes idle", () => {
    const messages = [
      user("message_1"),
      assistant("message_2", "message_1", { finish: "tool-calls", time: { created: 1, completed: 2 } }),
    ]

    expect(activeUserMessageID(messages, { type: "idle" })).toBeUndefined()
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
