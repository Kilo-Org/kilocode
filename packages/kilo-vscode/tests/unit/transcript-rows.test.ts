import { describe, expect, it } from "bun:test"
import { messageTurns } from "../../webview-ui/src/context/session-queue"
import { partitionRows, transcriptRows } from "../../webview-ui/src/context/transcript-rows"
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
    const turns = messageTurns([u1, a1, u2, a2, u3], "u3")
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
