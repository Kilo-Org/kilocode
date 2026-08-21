import { describe, expect, it } from "bun:test"
import { messageTurns } from "../../webview-ui/src/context/session-queue"
import { partitionRows, retainTurn, transcriptRows } from "../../webview-ui/src/context/transcript-rows"
import type { Message, Part } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string, opts: Partial<Message> = {}): Message => ({ ...base, id, role: "user", ...opts })
const assistant = (id: string, parentID: string, opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  parentID,
  role: "assistant",
  ...opts,
})
const part = (id: string, messageID: string): Part => ({ id, messageID, type: "text", text: id })
const toolPart = (id: string, messageID: string, tool: string, status = "completed"): Part =>
  ({ id, messageID, type: "tool", callID: `${id}-call`, tool, state: { status, input: {} } }) as unknown as Part
const lookup = (values: Record<string, Part[]>) => (id: string) => values[id] ?? []

describe("transcriptRows", () => {
  it("preserves turn order across user, bounded assistant, diff, and error rows", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1", { error: { name: "ProviderError" } })
    const u2 = user("u2")
    const a3 = assistant("a3", "u2")
    const parts = {
      u1: [part("up1", "u1")],
      a1: Array.from({ length: 10 }, (_, i) => part(`p${i}`, "a1")),
      a2: [part("p10", "a2")],
      a3: [part("p11", "a3")],
    }

    const rows = transcriptRows(messageTurns([u1, a1, a2, u2, a3]), lookup(parts))

    expect(rows.map((row) => `${row.turn}:${row.type}`)).toEqual([
      "u1:user",
      "u1:assistant",
      "u1:assistant",
      "u1:assistant",
      "u1:diff",
      "u1:error",
      "u2:user",
      "u2:assistant",
    ])
    expect(rows.filter((row) => row.type === "assistant").map((row) => row.parts.length)).toEqual([8, 2, 1, 1])
  })

  it("uses the configured bound and keeps an empty assistant renderable", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const rows = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: Array.from({ length: 7 }, (_, i) => part(`p${i}`, "a1")) }),
      { size: 3 },
    )

    expect(rows.filter((row) => row.type === "assistant").map((row) => row.parts.length)).toEqual([3, 3, 1, 0])
  })

  it("omits synthetic users for partial turns and carries row metadata", () => {
    const a1 = assistant("a1", "u1")
    const rows = transcriptRows(messageTurns([a1]), lookup({ a1: [part("p1", "a1")] }), {
      queued: new Set(["u1"]),
      live: new Set(["u1"]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: "assistant", turn: "u1", partial: true, queued: true, live: true })
  })

  it("places only the first visible non-abort error after diffs", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1", { error: { name: "MessageAbortedError" } })
    const a2 = assistant("a2", "u1", { error: { name: "HiddenError" } })
    const a3 = assistant("a3", "u1", { error: { name: "ShownError" } })
    const rows = transcriptRows(messageTurns([u1, a1, a2, a3]), lookup({}), { hidden: (id) => id === "a2" })

    expect(rows.slice(-2).map((row) => row.type)).toEqual(["diff", "error"])
    expect(rows.at(-1)).toMatchObject({ type: "error", message: a3, error: a3.error })
  })

  it("hides provider errors at and after an assistant part boundary", () => {
    const revert = { messageID: "message_2", partID: "part_2" }
    const u1 = user("message_1")
    const a1 = assistant("message_2", "message_1", { error: { name: "ProviderError" } })
    const a2 = assistant("message_3", "message_1", { error: { name: "ProviderError" } })
    const parts = { message_2: [part("part_1", "message_2"), part("part_2", "message_2")] }
    const rows = transcriptRows(messageTurns([u1, a1, a2], revert), lookup(parts), { revert })

    expect(rows.map((row) => row.type)).toEqual(["user", "assistant"])
    expect(rows.filter((row) => row.type === "assistant").flatMap((row) => row.parts.map((item) => item.id))).toEqual([
      "part_1",
    ])
    expect(rows.some((row) => row.message.id === "message_3")).toBe(false)
  })

  it("keeps provider errors before an assistant part boundary", () => {
    const revert = { messageID: "message_3", partID: "part_2" }
    const u1 = user("message_1")
    const a1 = assistant("message_2", "message_1", { error: { name: "ProviderError" } })
    const a2 = assistant("message_3", "message_1")
    const parts = { message_3: [part("part_1", "message_3"), part("part_2", "message_3")] }
    const rows = transcriptRows(messageTurns([u1, a1, a2], revert), lookup(parts), { revert })

    expect(rows.at(-1)).toMatchObject({ type: "error", message: a1 })
  })

  it("keeps keys stable when older turns are prepended and parts are appended", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = Array.from({ length: 8 }, (_, i) => part(`p${i}`, "a1"))
    const current = transcriptRows(messageTurns([u1, a1]), lookup({ a1: parts }))
    const older = user("u0")
    const next = transcriptRows(messageTurns([older, u1, a1]), lookup({ a1: [...parts, part("p8", "a1")] }))

    expect(next.find((row) => row.type === "user" && row.turn === "u1")?.key).toBe(current[0]?.key)
    expect(next.find((row) => row.type === "assistant" && row.parts[0]?.id === "p0")?.key).toBe(current[1]?.key)
  })

  it("reuses unchanged rows across prepend and append updates", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const p1 = part("p1", "a1")
    const first = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [p1] }))
    const u0 = user("u0")
    const a2 = assistant("a2", "u2")
    const second = transcriptRows(messageTurns([u0, u1, a1, u2, a2]), lookup({ a1: [p1] }), {}, first)

    expect(second[1]).toBe(first[0])
    expect(second[2]).toBe(first[1])
    expect(second[3]).not.toBe(first[2])
    expect(second[4]).not.toBe(first[2])
  })

  it("selects the last real assistant text part as the copy target", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const synthetic: Part = { ...part("p2", "a2"), synthetic: true }
    const blank: Part = { ...part("p3", "a2"), text: " " }
    const rows = transcriptRows(messageTurns([u1, a1, a2]), lookup({ a1: [part("p1", "a1")], a2: [synthetic, blank] }))

    expect(rows.filter((row) => row.type === "assistant").map((row) => row.copy)).toEqual(["p1", "p1"])
  })

  it("keeps compaction replies ordered under the compacted turn and respects revert turns", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2", {
      parts: [{ id: "compact", messageID: "u2", type: "compaction", auto: false }],
    })
    const a2 = assistant("a2", "u1")
    const u3 = user("u3")
    const turns = messageTurns([u1, a1, u2, a2, u3], { messageID: "u3" })
    const rows = transcriptRows(turns, (id) => (id === "u2" ? (u2.parts ?? []) : []))

    expect(rows.map((row) => `${row.turn}:${row.message.id}`)).toEqual(["u1:u1", "u1:a1", "u2:u2", "u2:a2"])
  })

  it("replaces only rows whose data or metadata changed", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const p1 = part("p1", "a1")
    const first = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [p1] }))
    const changed = { ...p1, text: "changed" }
    const second = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [changed] }), {}, first)

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])

    const live = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [changed] }), { live: new Set(["u1"]) }, second)
    expect(live[0]).not.toBe(second[0])
    expect(live[1]).not.toBe(second[1])
  })
})

describe("retainTurn", () => {
  it("keeps the completed turn mounted until another turn takes ownership", () => {
    const active = retainTurn(undefined, "session", "u1", false)
    expect(retainTurn(active, "session", undefined, false)).toBe(active)
    expect(retainTurn(active, "session", "u2", false)).toEqual({ sid: "session", turn: "u2" })
  })

  it("keeps the paused turn and clears it when the session changes", () => {
    const active = { sid: "session", turn: "u1" }
    expect(retainTurn(active, "session", "u2", true)).toBe(active)
    expect(retainTurn(active, "other", undefined, false)).toBeUndefined()
  })
})

describe("partitionRows", () => {
  it("keeps completed history and the active user row virtualized", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const parts = Array.from({ length: 18 }, (_, i) => part(`p${i}`, "a2"))
    const rows = transcriptRows(messageTurns([u1, a1, u2, a2]), lookup({ a1: [part("old", "a1")], a2: parts }), {
      live: new Set(["u2"]),
    })
    const result = partitionRows(rows, new Set(["u2"]))

    expect(result.virtual.map((row) => `${row.turn}:${row.type}`)).toEqual([
      "u1:user",
      "u1:assistant",
      "u2:user",
      "u2:assistant",
      "u2:assistant",
    ])
    expect(result.direct.flatMap((row) => (row.type === "assistant" ? row.parts : [])).map((item) => item.id)).toEqual([
      "p16",
      "p17",
    ])
  })

  it("keeps trailing diff and error rows after the direct assistant suffix", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1", { error: { name: "ProviderError" } })
    const rows = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
    })
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => row.type)).toEqual(["user"])
    expect(result.direct.map((row) => row.type)).toEqual(["assistant", "diff", "error"])
  })

  it("keeps a compact activity mounted when final assistant text arrives", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const rows = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: [toolPart("t1", "a1", "read")], a2: [part("say", "a2")] }),
      { compact: true, live: new Set(["u1"]) },
    )
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => row.type)).toEqual(["user"])
    expect(result.direct.map((row) => row.type)).toEqual(["activity", "assistant"])
  })

  it("returns a completed suffix to virtual history after queue handoff", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const first = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
      queued: new Set(["u2"]),
    })
    const active = partitionRows(first, new Set(["u1"]))
    expect(active.virtual.map((row) => row.type)).toEqual(["user"])
    expect(active.direct.map((row) => row.turn)).toEqual(["u1"])
    expect(active.queued.map((row) => row.turn)).toEqual(["u2"])

    const second = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u2"]),
    })
    const handed = partitionRows(second, new Set(["u2"]))

    expect(handed.direct).toEqual([])
    expect(handed.virtual.filter((row) => row.turn === "u1")).toHaveLength(2)
    expect(handed.virtual.filter((row) => row.turn === "u2")).toHaveLength(1)
  })

  it("does not retain an older turn after a newer visible turn", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const rows = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }))
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => `${row.turn}:${row.type}`)).toEqual(["u1:user", "u1:assistant", "u2:user"])
    expect(result.direct).toEqual([])
  })

  it("skips a held turn without assistant output", () => {
    const u1 = user("u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const rows = transcriptRows(messageTurns([u1, u2, a2]), lookup({ a2: [part("p1", "a2")] }))
    const result = partitionRows(rows, new Set(["u1", "u2"]))

    expect(result.virtual.map((row) => row.turn)).toEqual(["u1", "u2"])
    expect(result.direct.map((row) => `${row.turn}:${row.type}`)).toEqual(["u2:assistant"])
  })

  it("keeps queued rows after virtual and direct rows", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const rows = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
      queued: new Set(["u2"]),
    })
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => row.type)).toEqual(["user"])
    expect(result.direct.map((row) => row.type)).toEqual(["assistant"])
    expect(result.queued.map((row) => row.turn)).toEqual(["u2"])
    expect(result.queued[0]).toMatchObject({ type: "user", queued: true })
  })
})

describe("transcriptRows compact tool activity", () => {
  it("merges the per-step assistant rows into one explicit activity row", () => {
    // The agent emits one assistant message per step, so without coalescing the
    // activity group would only ever see the single part in each row.
    const u1 = user("u1")
    const steps = ["a1", "a2", "a3", "a4"].map((id) => assistant(id, "u1"))
    const parts = {
      a1: [toolPart("t1", "a1", "read")],
      a2: [toolPart("t2", "a2", "read")],
      a3: [toolPart("t3", "a3", "grep")],
      a4: [part("say", "a4")],
    }
    const turns = messageTurns([u1, ...steps])

    const flat = transcriptRows(turns, lookup(parts))
    expect(flat.filter((row) => row.type === "assistant").map((row) => row.parts.length)).toEqual([1, 1, 1, 1])

    const rows = transcriptRows(turns, lookup(parts), { compact: true })
    const activity = rows.find((row) => row.type === "activity")
    const assistants = rows.filter((row) => row.type === "assistant")
    expect(activity?.items.map((item) => item.part.id)).toEqual(["t1", "t2", "t3"])
    expect(activity?.items.map((item) => item.message.id)).toEqual(["a1", "a2", "a3"])
    expect(activity?.key).toBe("u1:activity:t1")
    expect(assistants.map((row) => row.key)).toEqual(["u1:assistant:a4:say"])
  })

  it("ignores bookkeeping parts that never render", () => {
    // Each assistant message also carries step-start/step-finish parts. Treating
    // one of those as a blocker stopped every run from coalescing at all.
    const u1 = user("u1")
    const steps = ["a1", "a2", "a3"].map((id) => assistant(id, "u1"))
    const step = (id: string, messageID: string): Part => ({ id, messageID, type: "step-start" }) as unknown as Part
    const parts = {
      a1: [step("s1", "a1"), toolPart("t1", "a1", "read")],
      a2: [step("s2", "a2"), toolPart("t2", "a2", "grep")],
      a3: [step("s3", "a3"), toolPart("t3", "a3", "bash")],
    }
    const turns = messageTurns([u1, ...steps])
    const renderable = (part: Part) => part.type !== "step-start"

    // Without the predicate the step parts block every merge.
    const blocked = transcriptRows(turns, lookup(parts), { compact: true })
    expect(blocked.filter((row) => row.type === "assistant")).toHaveLength(3)

    const rows = transcriptRows(turns, lookup(parts), { compact: true, renderable })
    const activity = rows.find((row) => row.type === "activity")
    expect(rows.filter((row) => row.type === "assistant")).toHaveLength(0)
    expect(activity?.items.map((item) => item.part.id)).toEqual(["t1", "t2", "t3"])
  })

  it("breaks a run on a row that must keep its own card", () => {
    const u1 = user("u1")
    const steps = ["a1", "a2", "a3", "a4"].map((id) => assistant(id, "u1"))
    const parts = {
      a1: [toolPart("t1", "a1", "read")],
      a2: [toolPart("t2", "a2", "question", "running")],
      a3: [toolPart("t3", "a3", "read")],
      a4: [toolPart("t4", "a4", "grep")],
    }

    const rows = transcriptRows(messageTurns([u1, ...steps]), lookup(parts), { compact: true })

    expect(rows.map((row) => row.type)).toEqual(["user", "activity", "assistant", "activity"])
    const activity = rows.filter((row) => row.type === "activity")
    expect(activity.map((row) => row.items.map((item) => item.part.id))).toEqual([["t1"], ["t3", "t4"]])
  })

  it("keeps the row key stable as a run grows from one step to many", () => {
    // The streaming row is looked up by key, so a key that changed when the second
    // step arrived remounted the row mid-turn and lost the scroll anchor.
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const one = { a1: [toolPart("t1", "a1", "read")] }
    const two = { ...one, a2: [toolPart("t2", "a2", "grep")] }

    const first = transcriptRows(messageTurns([u1, a1]), lookup(one), { compact: true })
    const grown = transcriptRows(messageTurns([u1, a1, a2]), lookup(two), { compact: true })

    const key = first.find((row) => row.type === "activity")!.key
    expect(key).toBe("u1:activity:t1")
    expect(grown.filter((row) => row.type === "activity").map((row) => row.key)).toEqual([key])
  })

  it("does not split a live activity for an empty assistant step", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const rows = transcriptRows(messageTurns([u1, a1, a2]), lookup({ a1: [toolPart("t1", "a1", "read")] }), {
      compact: true,
      live: new Set(["u1"]),
    })

    expect(rows.map((row) => row.type)).toEqual(["user", "activity"])
    const activity = rows.find((row) => row.type === "activity")
    expect(activity?.key).toBe("u1:activity:t1")
    expect(activity?.working).toBe(true)
  })

  it("never merges across turns", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const parts = { a1: [toolPart("t1", "a1", "read")], a2: [toolPart("t2", "a2", "read")] }

    const rows = transcriptRows(messageTurns([u1, a1, u2, a2]), lookup(parts), { compact: true })

    expect(rows.map((row) => `${row.turn}:${row.type}`)).toEqual(["u1:user", "u1:activity", "u2:user", "u2:activity"])
  })

  it("keeps each activity item bound to its real assistant message", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1", { modelID: "model-one" })
    const a2 = assistant("a2", "u1", { modelID: "model-two" })
    const rows = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: [toolPart("t1", "a1", "read")], a2: [toolPart("t2", "a2", "grep")] }),
      { compact: true },
    )

    const activity = rows.find((row) => row.type === "activity")
    expect(activity?.items.map((item) => [item.part.messageID, item.message.id, item.message.modelID])).toEqual([
      ["a1", "a1", "model-one"],
      ["a2", "a2", "model-two"],
    ])
  })

  it("replaces an updated item without changing the activity row key or earlier item identity", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const t1 = toolPart("t1", "a1", "read")
    const t2 = toolPart("t2", "a2", "grep", "running")
    const first = transcriptRows(messageTurns([u1, a1, a2]), lookup({ a1: [t1], a2: [t2] }), {
      compact: true,
      live: new Set(["u1"]),
    })
    const done = { ...t2, state: { ...t2.state, status: "completed" } } as Part
    const second = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: [t1], a2: [done] }),
      { compact: true, live: new Set(["u1"]) },
      first,
    )

    const before = first.find((row) => row.type === "activity")!
    const after = second.find((row) => row.type === "activity")!
    expect(after.key).toBe(before.key)
    expect(after.items[0]).toBe(before.items[0])
    expect(after.items[0]!.part).toBe(t1)
    expect(after.items[1]!.part).toBe(done)
    expect(after.working).toBe(true)
  })

  it("shares existing activity items when a later tool is appended", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const t1 = toolPart("t1", "a1", "read")
    const first = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [t1] }), { compact: true })
    const second = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: [t1], a2: [toolPart("t2", "a2", "grep")] }),
      { compact: true },
      first,
    )

    const before = first.find((row) => row.type === "activity")!
    const after = second.find((row) => row.type === "activity")!
    expect(after.items).toHaveLength(2)
    expect(after.items[0]).toBe(before.items[0])
  })

  it("keeps failed tools outside activity rows", () => {
    const u1 = user("u1")
    const steps = ["a1", "a2", "a3"].map((id) => assistant(id, "u1"))
    const rows = transcriptRows(
      messageTurns([u1, ...steps]),
      lookup({
        a1: [toolPart("t1", "a1", "read")],
        a2: [toolPart("t2", "a2", "bash", "error")],
        a3: [toolPart("t3", "a3", "grep")],
      }),
      { compact: true },
    )

    expect(rows.map((row) => row.type)).toEqual(["user", "activity", "assistant", "activity"])
  })

  it("leaves rows untouched when the flag is off", () => {
    const u1 = user("u1")
    const steps = ["a1", "a2"].map((id) => assistant(id, "u1"))
    const parts = { a1: [toolPart("t1", "a1", "read")], a2: [toolPart("t2", "a2", "read")] }
    const turns = messageTurns([u1, ...steps])

    const off = transcriptRows(turns, lookup(parts))
    expect(off.filter((row) => row.type === "assistant").map((row) => row.key)).toEqual([
      "u1:assistant:a1:t1",
      "u1:assistant:a2:t2",
    ])
  })
})
