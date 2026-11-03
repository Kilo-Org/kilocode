import { describe, expect, test } from "bun:test"
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode/client"
import { messageTurnRanges, turnMetadata } from "../webview-ui/src/v2/message-status"
import { partitionTranscript, TRANSCRIPT_CHUNK_SIZE } from "../webview-ui/src/v2/transcript"

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

describe("partitionTranscript", () => {
  test("chunks a large assistant message into rows with stable keys", () => {
    const message = assistant({ id: "a1", created: 1, parts: textParts(18) })
    const messages = [user("u1", 0), message]
    const partition = partitionTranscript(messages, [], false)
    const rows = partition.rows.flatMap((row) => (row.type === "assistant" ? [row] : []))

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
    const first = partitionTranscript(messages, [], false)
    const before = first.rows.flatMap((row) => (row.type === "assistant" ? [row] : []))

    message.content.push({ type: "text", text: "later" })
    const second = partitionTranscript(messages, [], false, first)
    const after = second.rows.flatMap((row) => (row.type === "assistant" ? [row] : []))

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
    const rows = partitionTranscript(messages, [], false).rows

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

  test("keeps the live turn direct and completed turns virtual", () => {
    const messages = [
      user("u1", 0),
      assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" }),
      idle("i1", 3),
      user("u2", 4),
      assistant({ id: "a2", created: 5, streamed: 6, text: "live" }),
    ]
    const live = partitionTranscript(messages, [], true)
    const settled = partitionTranscript(messages, [], false)

    expect(live.virtualKeys).toEqual(["u1:user", "a1:assistant:0"])
    expect(live.directKeys).toEqual(["u2:user", "a2:assistant:0"])
    expect(settled.directKeys).toEqual([])
    expect(settled.virtualKeys).toEqual(["u1:user", "a1:assistant:0", "u2:user", "a2:assistant:0"])
  })

  test("keeps a live turn with no assistant row virtualized", () => {
    const messages = [
      user("u1", 0),
      assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" }),
      idle("i1", 3),
      user("u2", 4),
    ]
    const partition = partitionTranscript(messages, [], true)

    expect(partition.directKeys).toEqual([])
    expect(partition.virtualKeys).toContain("u2:user")
  })

  test("keeps queued prompts outside the transcript rows", () => {
    const messages = [user("u1", 0), assistant({ id: "a1", created: 1, completed: 2, text: "done", finish: "stop" })]
    const queue = [queued("q1")]
    const partition = partitionTranscript(messages, queue, false)

    expect(partition.queued).toEqual([{ key: "queued:q1", item: queue[0] }])
    expect(partition.rows.some((row) => row.key === "queued:q1")).toBe(false)

    const next = partitionTranscript([...messages, user("u2", 3)], queue, false, partition)
    expect(next.queued[0]).toBe(partition.queued[0])
  })

  test("shows an idle error only when no failed step already shows it", () => {
    const error: SessionStructuredError = { type: "unknown", message: "failed" }
    const stepFailure = partitionTranscript(
      [user("u1", 0), assistant({ id: "a1", created: 1, completed: 2, finish: "error", error }), idle("i1", 3, error)],
      [],
      false,
    )
    const runFailure = partitionTranscript([user("u1", 0), idle("i1", 1, error)], [], false)

    expect(stepFailure.rows.some((row) => row.type === "error")).toBe(false)
    expect(runFailure.rows.filter((row) => row.type === "error")).toHaveLength(1)
    expect(runFailure.rows.find((row) => row.type === "error")?.key).toBe("idle:i1")
  })
})
