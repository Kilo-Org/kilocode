import { describe, expect, test } from "bun:test"
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode/client"
import { messageTurnRanges, turnMetadata } from "../webview-ui/src/v2/message-status"
import {
  anchorOffset,
  DIRECT_TAIL_ROWS,
  handedRows,
  partitionTranscript,
  retainTurn,
  shiftedScroll,
  TRANSCRIPT_CHUNK_SIZE,
  transcriptRows,
} from "../webview-ui/src/v2/transcript"

const user = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) as unknown as SessionMessageInfo

const idle = (id: string, created: number, error?: SessionStructuredError) =>
  ({
    id,
    type: "idle",
    time: { created },
    outcome: error ? "failed" : "succeeded",
    error,
  }) as unknown as SessionMessageInfo

const assistant = (input: {
  id: string
  created: number
  streamed?: number
  completed?: number
  finish?: SessionMessageAssistant["finish"]
  output?: number
  text?: string
  parts?: SessionMessageAssistant["content"]
  error?: SessionStructuredError
}) =>
  ({
    id: input.id,
    type: "assistant",
    content: input.parts ?? (input.text ? [{ type: "text", text: input.text }] : []),
    time: { created: input.created, streamed: input.streamed, completed: input.completed },
    finish: input.finish,
    tokens:
      input.output === undefined
        ? undefined
        : { input: 0, output: input.output, reasoning: 0, cache: { read: 0, write: 0 } },
    error: input.error,
  }) as unknown as SessionMessageAssistant

const textParts = (count: number): SessionMessageAssistant["content"] =>
  Array.from({ length: count }, (_, index) => ({ type: "text", text: `part ${index}` }))

const queued = (id: string) =>
  ({
    id,
    sessionID: "s",
    type: "user",
    delivery: "queue",
    payload: { text: id },
    time: { created: 0 },
  }) as unknown as SessionInboxUser

test("range metadata matches turnMetadata for every step", () => {
  const messages = [
    user("u1", 100),
    assistant({ id: "a1", created: 200, streamed: 300, output: 10, text: "first", finish: "tool-calls" }),
    user("u2", 350),
    assistant({ id: "a2", created: 400, streamed: 500, completed: 600, output: 20, finish: "stop" }),
    idle("i1", 700),
    user("u3", 800),
    assistant({ id: "a3", created: 900, completed: 1000, text: "done", finish: "stop" }),
  ]
  const ranges = messageTurnRanges(messages)

  for (const message of messages) {
    if (message.type !== "assistant") continue
    const expected = ranges.find((item) =>
      messages.slice(item.start, item.end).some((entry) => entry.id === message.id),
    )
    expect(turnMetadata(message, messages)).toEqual(expected?.metadata)
  }
})

test("marks the first user input as the turn diff anchor", () => {
  const ranges = messageTurnRanges([
    user("u1", 100),
    assistant({ id: "a1", created: 200, completed: 300, text: "done", finish: "stop" }),
    idle("i1", 400),
  ])
  expect(ranges[0].turn).toBe("u1")
  expect(ranges[0].userTurn).toBe("u1")
})

test("leaves the turn diff anchor empty when the opener is outside the page", () => {
  const ranges = messageTurnRanges([
    assistant({ id: "a0", created: 100, completed: 200, text: "prefix", finish: "stop" }),
    idle("i1", 300),
  ])
  expect(ranges[0].turn).toBe("a0")
  expect(ranges[0].userTurn).toBeUndefined()
})

test("leaves the turn diff anchor empty for a synthetic input", () => {
  const synthetic = { id: "s1", type: "synthetic", time: { created: 100 } } as unknown as SessionMessageInfo
  const ranges = messageTurnRanges([
    synthetic,
    assistant({ id: "a1", created: 200, completed: 300, text: "done", finish: "stop" }),
    idle("i1", 400),
  ])
  expect(ranges[0].turn).toBe("s1")
  expect(ranges[0].userTurn).toBeUndefined()
})

test("carries the user anchor on assistant rows", () => {
  const rows = transcriptRows([
    user("u1", 100),
    assistant({ id: "a1", created: 200, completed: 300, text: "done", finish: "stop" }),
  ])
  expect(rows.flatMap((row) => (row.type === "assistant" ? [row.userTurn] : []))).toEqual(["u1"])
})

test("keeps the footer on a prefix step when a later steer has no text", () => {
  const prefix = assistant({
    id: "a0",
    created: 100,
    streamed: 150,
    completed: 200,
    output: 10,
    text: "prefix",
    finish: "tool-calls",
  })
  const messages = [
    prefix,
    user("u2", 300),
    assistant({ id: "a2", created: 400, streamed: 450, completed: 500, output: 10, finish: "stop" }),
    idle("i1", 600),
  ]
  const range = messageTurnRanges(messages)[0]
  const carrier = transcriptRows(messages).flatMap((row) =>
    row.type === "assistant" && row.message.id === "a0" && row.metadata ? [row] : [],
  )[0]

  expect(range.metadata?.carrierID).toBe("a0")
  expect(carrier?.metadata).toEqual(turnMetadata(prefix, messages))
})

describe("partitionTranscript", () => {
  test("chunks a large assistant message into rows with stable keys", () => {
    const message = assistant({ id: "a1", created: 1, parts: textParts(18) })
    const messages = [user("u1", 0), message]
    const all = transcriptRows(messages)
    const partition = partitionTranscript(all, [], new Set())
    const rows = all.flatMap((row) => (row.type === "assistant" ? [row] : []))

    expect(partition.virtualKeys).toEqual(["u1:user", "a1:assistant:0", "a1:assistant:8", "a1:assistant:16"])
    expect(rows.map((row) => row.start)).toEqual([0, TRANSCRIPT_CHUNK_SIZE, TRANSCRIPT_CHUNK_SIZE * 2])
    expect(rows.map((row) => row.parts.length)).toEqual([8, 8, 2])
    expect(rows[1].parts[0]).toBe(message.content[8])
    expect(rows.every((row) => row.turn === "u1")).toBe(true)
  })

  test("reuses unchanged rows and keeps the chunk key when a part streams in", () => {
    const parts = textParts(9)
    const message = assistant({ id: "a1", created: 1, parts })
    const messages = [user("u1", 0), message]
    const first = transcriptRows(messages)
    const before = first.flatMap((row) => (row.type === "assistant" ? [row] : []))

    message.content.push({ type: "text", text: "later" })
    const second = transcriptRows(messages, first)
    const after = second.flatMap((row) => (row.type === "assistant" ? [row] : []))

    expect(after[0]).toBe(before[0])
    expect(after[1].key).toBe(before[1].key)
    expect(after.map((row) => row.start)).toEqual([0, 8])
    expect(after[1].parts).toHaveLength(2)
  })

  test("computes turn metadata once and attaches it to the carrier row", () => {
    const messages = [
      user("u1", 100),
      assistant({ id: "a1", created: 200, streamed: 300, output: 50, text: "first", finish: "tool-calls" }),
      assistant({ id: "a2", created: 400, streamed: 500, completed: 600, output: 20, finish: "stop" }),
      idle("i1", 700),
    ]
    const ranges = messageTurnRanges(messages)
    const rows = transcriptRows(messages)

    expect(ranges).toHaveLength(1)
    expect(ranges[0].metadata?.carrierID).toBe("a1")
    const carriers = rows.flatMap((row) => (row.type === "assistant" && row.metadata ? [row] : []))
    expect(carriers.map((row) => row.key)).toEqual(["a1:assistant:0"])
    expect(carriers[0].metadata?.timing).toEqual({ completedAt: 600, durationMs: 500 })
  })

  test("derives one metadata entry per turn in a single range pass", () => {
    const messages = [
      user("u1", 100),
      assistant({ id: "a1", created: 200, completed: 300, text: "first", finish: "stop" }),
      idle("i1", 400),
      user("u2", 500),
      assistant({ id: "a2", created: 600, completed: 700, text: "second", finish: "stop" }),
      idle("i2", 800),
    ]
    const ranges = messageTurnRanges(messages)

    expect(ranges.map((range) => range.turn)).toEqual(["u1", "u2"])
    expect(ranges.map((range) => range.metadata?.carrierID)).toEqual(["a1", "a2"])
    expect(ranges[1].metadata?.timing).toEqual({ completedAt: 700, durationMs: 200 })
  })

  test("keeps only the latest direct turn out of the virtual window", () => {
    const rows = transcriptRows([
      user("u1", 0),
      assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" }),
      idle("i1", 3),
      user("u2", 4),
      assistant({ id: "a2", created: 5, streamed: 6, text: "live" }),
    ])
    const latest = partitionTranscript(rows, [], new Set(["u2"]))
    const older = partitionTranscript(rows, [], new Set(["u1"]))
    const none = partitionTranscript(rows, [], new Set())

    expect(latest.virtualKeys).toEqual(["u1:user", "a1:assistant:0"])
    expect(latest.directKeys).toEqual(["u2:user", "a2:assistant:0"])
    expect(older.directKeys).toEqual([])
    expect(none.virtualKeys).toEqual(["u1:user", "a1:assistant:0", "u2:user", "a2:assistant:0"])
  })

  test("keeps a live turn with no assistant row virtualized", () => {
    const messages = [
      user("u1", 0),
      assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" }),
      idle("i1", 3),
      user("u2", 4),
    ]
    const partition = partitionTranscript(transcriptRows(messages), [], new Set(["u2"]))

    expect(partition.directKeys).toEqual([])
    expect(partition.virtualKeys).toContain("u2:user")
  })

  test("keeps only the last rows of a long live turn direct", () => {
    const messages = [user("u1", 0)]
    for (let index = 0; index < 30; index++) {
      messages.push(assistant({ id: `a${index}`, created: index + 1, text: `step ${index}` }))
    }
    const rows = transcriptRows(messages)
    const partition = partitionTranscript(rows, [], new Set(["u1"]))

    expect(partition.directKeys).toEqual(rows.slice(-DIRECT_TAIL_ROWS).map((row) => row.key))
    expect(partition.virtualKeys).toEqual(rows.slice(0, -DIRECT_TAIL_ROWS).map((row) => row.key))
    expect(partition.directKeys).toHaveLength(DIRECT_TAIL_ROWS)
  })

  test("cuts between the chunk rows of one message without moving either", () => {
    const message = assistant({
      id: "a1",
      created: 1,
      parts: textParts(TRANSCRIPT_CHUNK_SIZE * (DIRECT_TAIL_ROWS + 2)),
    })
    const messages = [user("u1", 0), message]
    const rows = transcriptRows(messages)
    const partition = partitionTranscript(rows, [], new Set(["u1"]))

    expect(partition.directKeys).toEqual(rows.slice(-DIRECT_TAIL_ROWS).map((row) => row.key))
    expect(partition.virtualKeys[0]).toBe("u1:user")
    expect(partition.directKeys[0]).toBe(`a1:assistant:${TRANSCRIPT_CHUNK_SIZE * 2}`)
  })

  test("hands the oldest tail row to the virtual window on each new step", () => {
    const messages = [user("u1", 0)]
    let previous: ReturnType<typeof partitionTranscript> | undefined
    for (let step = 0; step < 20; step++) {
      messages.push(assistant({ id: `a${step}`, created: step + 1, text: `step ${step}` }))
      const rows = transcriptRows(messages)
      const partition = partitionTranscript(rows, [], new Set(["u1"]), previous)
      const keys = rows.map((row) => row.key)
      const shown = [...partition.virtualKeys, ...partition.directKeys]

      expect(shown.toSorted()).toEqual(keys.toSorted())
      expect(new Set(shown).size).toBe(keys.length)
      expect(partition.directKeys.length).toBeLessThanOrEqual(DIRECT_TAIL_ROWS)
      if (previous) {
        const moved = handedRows(previous.directKeys, new Map(partition.virtualKeys.map((key, index) => [key, index])))
        expect(moved.length).toBeLessThanOrEqual(1)
        if (previous.directKeys.length === DIRECT_TAIL_ROWS) expect(moved).toEqual([previous.directKeys[0]])
      }
      previous = partition
    }
  })

  test("keeps queued prompts outside the transcript rows", () => {
    const messages = [user("u1", 0), assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" })]
    const queue = [queued("q1")]
    const rows = transcriptRows(messages)
    const partition = partitionTranscript(rows, queue, new Set())

    expect(partition.queued).toEqual([{ key: "queued:q1", item: queue[0] }])
    expect(rows.some((row) => row.key === "queued:q1")).toBe(false)

    const next = partitionTranscript(transcriptRows([...messages, user("u2", 3)], rows), queue, new Set(), partition)
    expect(next.queued[0]).toBe(partition.queued[0])
  })

  test("shows an idle error only when no failed step already shows it", () => {
    const error: SessionStructuredError = { type: "unknown", message: "failed" }
    const stepFailure = transcriptRows([
      user("u1", 0),
      assistant({ id: "a1", created: 1, completed: 2, finish: "error", error }),
      idle("i1", 3, error),
    ])
    const runFailure = transcriptRows([user("u1", 0), idle("i1", 1, error)])

    expect(stepFailure.some((row) => row.type === "error")).toBe(false)
    expect(runFailure.filter((row) => row.type === "error")).toHaveLength(1)
    expect(runFailure.find((row) => row.type === "error")?.key).toBe("idle:i1")
  })
})

describe("retainTurn", () => {
  test("holds the last live turn after it completes until another turn is live", () => {
    const live = retainTurn(undefined, "s", "u1", false)
    const settled = retainTurn(live, "s", undefined, false)
    const next = retainTurn(settled, "s", "u2", false)

    expect(live).toEqual({ session: "s", turn: "u1" })
    expect(settled).toBe(live)
    expect(next).toEqual({ session: "s", turn: "u2" })
  })

  test("keeps the previous hold while scrolled away and drops it on a session switch", () => {
    const held = retainTurn(undefined, "s", "u1", false)

    expect(retainTurn(held, "s", "u2", true)).toBe(held)
    expect(retainTurn(held, "other", undefined, false)).toBeUndefined()
    expect(retainTurn(held, undefined, "u1", false)).toBeUndefined()
  })
})

describe("scroll anchors", () => {
  test("saves the row offset without the start margin", () => {
    expect(anchorOffset(1000, 66, 240)).toBe(694)
  })

  test("keeps a row in place when the row area starts higher or lower", () => {
    expect(shiftedScroll(800, 66, 12)).toBe(746)
    expect(shiftedScroll(800, 12, 66)).toBe(854)
  })

  test("keeps the direct rows that are now mounted in the virtual window", () => {
    const index = new Map([
      ["u2:user", 10],
      ["a2:assistant:0", 11],
    ])

    expect(handedRows(["u2:user", "a2:assistant:0", "older:user"], index)).toEqual(["u2:user", "a2:assistant:0"])
    expect(handedRows(undefined, index)).toEqual([])
  })
})

describe("transcript notices", () => {
  const synthetic = (id: string, created: number, description?: string) =>
    ({
      id,
      type: "synthetic",
      text: "the whole goal kickoff template",
      description,
      metadata: { source: "goal" },
      time: { created },
    }) as unknown as SessionMessageInfo

  test("shows a described synthetic input as one notice and hides one without a description", () => {
    const rows = transcriptRows([
      synthetic("s1", 1, "Goal: Ship the release"),
      assistant({ id: "a1", created: 2, text: "Working", completed: 3 }),
      idle("i1", 4),
      synthetic("s2", 5),
      assistant({ id: "a2", created: 6, text: "Still working", completed: 7 }),
    ])
    expect(rows.map((row) => row.type)).toEqual(["notice", "assistant", "assistant"])
    expect(rows[0]).toMatchObject({ type: "notice", text: "Goal: Ship the release", turn: rows[1]?.turn })
  })
})
