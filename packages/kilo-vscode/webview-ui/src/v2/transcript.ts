import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStructuredError,
} from "@opencode/client"
import { messageTurnRanges, type MessageTurnRange, type TurnMetadata } from "./message-status"

/** Content items grouped into one virtual row. A large message becomes several rows. */
export const TRANSCRIPT_CHUNK_SIZE = 8

interface TranscriptRowBase {
  key: string
  turn: string
}

export interface TranscriptUserRow extends TranscriptRowBase {
  type: "user"
  message: SessionMessageUser
}

export interface TranscriptAssistantRow extends TranscriptRowBase {
  type: "assistant"
  message: SessionMessageAssistant
  /** Index of the first rendered content item in the message. */
  start: number
  parts: SessionMessageAssistant["content"]
  metadata?: TurnMetadata
}

export interface TranscriptErrorRow extends TranscriptRowBase {
  type: "error"
  message: SessionMessageIdle
  error: SessionStructuredError
}

export type TranscriptRow = TranscriptUserRow | TranscriptAssistantRow | TranscriptErrorRow

export interface TranscriptQueuedRow {
  key: string
  item: SessionInboxUser
}

export interface TranscriptPartition {
  rows: TranscriptRow[]
  virtualKeys: string[]
  directKeys: string[]
  queued: TranscriptQueuedRow[]
}

/**
 * Builds the transcript rows in one pass, computing each turn's metadata once.
 * The latest turn stays direct while it streams; completed history and large
 * finished messages are virtualized.
 */
export function partitionTranscript(
  messages: readonly SessionMessageInfo[],
  queued: readonly SessionInboxUser[],
  live: boolean,
  previous?: TranscriptPartition,
): TranscriptPartition {
  const reused = reuseRows(transcriptRows(messages), previous)
  const split = splitDirect(reused, live)
  const priorQueued = new Map((previous?.queued ?? []).map((row) => [row.key, row]))
  return {
    rows: reused,
    virtualKeys: split.virtual.map((row) => row.key),
    directKeys: split.direct.map((row) => row.key),
    queued: queued.map((item) => {
      const key = `queued:${item.id}`
      const old = priorQueued.get(key)
      return old && old.item === item ? old : { key, item }
    }),
  }
}

function transcriptRows(messages: readonly SessionMessageInfo[]) {
  const ranges = messageTurnRanges(messages)
  const rows: TranscriptRow[] = []
  let rangeIndex = 0
  let turn = ""

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    while (rangeIndex < ranges.length && index >= ranges[rangeIndex].end) rangeIndex += 1
    const current = ranges[rangeIndex]
    const range = current && index >= current.start && index < current.end ? current : undefined
    if (range) turn = range.turn

    if (message.type === "user" && range) {
      rows.push({ type: "user", key: `${message.id}:user`, turn: range.turn, message })
    } else if (message.type === "assistant" && range) {
      rows.push(...assistantRows(message, range))
    } else if (message.type === "idle" && message.error && !stepFailed(messages[index - 1])) {
      // A run can fail before any step, for example without a usable model. The
      // idle row carries that error; a failed step shows its own error instead.
      rows.push({
        type: "error",
        key: `idle:${message.id}`,
        turn: turn || message.id,
        message,
        error: message.error,
      })
    }
  }

  return rows
}

function assistantRows(message: SessionMessageAssistant, range: MessageTurnRange): TranscriptAssistantRow[] {
  const metadata = range.metadata?.carrierID === message.id ? range.metadata : undefined
  if (message.content.length === 0) {
    return [
      { type: "assistant", key: `${message.id}:assistant:0`, turn: range.turn, message, start: 0, parts: [], metadata },
    ]
  }
  const rows: TranscriptAssistantRow[] = []
  for (let start = 0; start < message.content.length; start += TRANSCRIPT_CHUNK_SIZE) {
    rows.push({
      type: "assistant",
      key: `${message.id}:assistant:${start}`,
      turn: range.turn,
      message,
      start,
      parts: message.content.slice(start, start + TRANSCRIPT_CHUNK_SIZE),
      metadata,
    })
  }
  return rows
}

/**
 * The latest turn stays out of the virtual window while it streams, so growing
 * measurements never remount live rows. Completed history is virtualized.
 */
function splitDirect(rows: TranscriptRow[], live: boolean) {
  const turn = live ? rows.at(-1)?.turn : undefined
  const boundary = turn ? rows.findIndex((row) => row.turn === turn) : -1
  const direct = boundary >= 0 ? rows.slice(boundary) : []
  // The live turn has no renderable assistant row yet, so keep it virtualized.
  if (!direct.some((row) => row.type === "assistant")) return { virtual: rows, direct: [] }
  return { virtual: rows.slice(0, boundary), direct }
}

function stepFailed(message: SessionMessageInfo | undefined) {
  return message?.type === "assistant" && !!message.error
}

function reuseRows(rows: TranscriptRow[], previous?: TranscriptPartition) {
  if (!previous?.rows.length) return rows
  const prior = new Map(previous.rows.map((row) => [row.key, row]))
  return rows.map((row) => {
    const old = prior.get(row.key)
    return old && sameRow(old, row) ? old : row
  })
}

function sameRow(left: TranscriptRow, right: TranscriptRow) {
  if (left.type !== right.type || left.turn !== right.turn) return false
  if (left.type === "user" && right.type === "user") return left.message === right.message
  if (left.type === "assistant" && right.type === "assistant") {
    return (
      left.message === right.message &&
      left.start === right.start &&
      sameParts(left.parts, right.parts) &&
      sameMetadata(left.metadata, right.metadata)
    )
  }
  if (left.type === "error" && right.type === "error") {
    return left.message === right.message && left.error === right.error
  }
  return false
}

function sameParts(left: SessionMessageAssistant["content"], right: SessionMessageAssistant["content"]) {
  if (left.length !== right.length) return false
  return left.every((part, index) => part === right[index])
}

function sameMetadata(left?: TurnMetadata, right?: TurnMetadata) {
  if (!left || !right) return left === right
  return (
    left.carrierID === right.carrierID &&
    left.timing.completedAt === right.timing.completedAt &&
    left.timing.durationMs === right.timing.durationMs &&
    left.tokensPerSecond === right.tokensPerSecond
  )
}
