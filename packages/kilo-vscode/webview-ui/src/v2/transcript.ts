import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageSynthetic,
  SessionMessageUser,
  SessionStructuredError,
} from "@opencode/client"
import { messageTurnRanges, type MessageTurnRange, type TurnMetadata } from "./message-status"

/** Content items grouped into one virtual row. A large message becomes several rows. */
export const TRANSCRIPT_CHUNK_SIZE = 8

interface TranscriptRowBase {
  key: string
  turn: string
  /** The turn's first user message, when one is on the page. */
  userTurn?: string
}

export interface TranscriptUserRow extends TranscriptRowBase {
  type: "user"
  message: SessionMessageUser
  answered: boolean
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

/** Synthetic input with a description, such as the kickoff of a `/goal`, shown as one notice line. */
export interface TranscriptNoticeRow extends TranscriptRowBase {
  type: "notice"
  message: SessionMessageSynthetic
  text: string
}

export type TranscriptRow = TranscriptUserRow | TranscriptAssistantRow | TranscriptErrorRow | TranscriptNoticeRow

export interface TranscriptQueuedRow {
  key: string
  item: SessionInboxUser
}

export interface TranscriptPartition {
  virtualKeys: string[]
  directKeys: string[]
  queued: TranscriptQueuedRow[]
}

/** The turn kept out of the virtual window after it was live in this view. */
export interface TranscriptHold {
  session: string
  turn: string
}

/**
 * Builds the transcript rows in one pass, computing each turn's metadata once.
 * Rows that did not change keep their previous object, so the list does not
 * re-render them.
 */
export function transcriptRows(messages: readonly SessionMessageInfo[], previous?: readonly TranscriptRow[]) {
  return reuseRows(buildRows(messages), previous)
}

/** Rows of the active turn kept out of the virtual window. */
export const DIRECT_TAIL_ROWS = 8

/**
 * Splits the rows into the virtual window and the direct tail. Only the latest
 * turn can render directly, and only when it is in `direct` and has an
 * assistant row. Only its last few rows stay direct: a long autonomous turn can
 * carry hundreds of steps, and mounting all of them keeps every tool card and
 * Markdown body alive, which blocks the first paint and every scroll frame for
 * rows that are far above the viewport. Older rows of the turn settle before
 * they leave the tail, so handing them to the virtualizer mid-turn does not
 * remount the streaming step.
 */
export function partitionTranscript(
  rows: readonly TranscriptRow[],
  queued: readonly SessionInboxUser[],
  direct: ReadonlySet<string>,
  previous?: TranscriptPartition,
): TranscriptPartition {
  const split = splitDirect(rows, direct)
  const priorQueued = new Map((previous?.queued ?? []).map((row) => [row.key, row]))
  return {
    virtualKeys: split.virtual.map((row) => row.key),
    directKeys: split.direct.map((row) => row.key),
    queued: queued.map((item) => {
      const key = `queued:${item.id}`
      const old = priorQueued.get(key)
      return old && old.item === item ? old : { key, item }
    }),
  }
}

/**
 * Keeps the last live turn direct until another turn becomes live or the
 * session changes. While the user has scrolled away, a new live turn does not
 * replace the hold, so it is handed to the virtualizer when it completes.
 */
export function retainTurn(
  previous: TranscriptHold | undefined,
  session: string | undefined,
  turn: string | undefined,
  paused: boolean,
): TranscriptHold | undefined {
  if (!session) return undefined
  if (!turn || paused) {
    if (previous?.session === session) return previous
    return turn ? { session, turn } : undefined
  }
  if (previous?.session === session && previous.turn === turn) return previous
  return { session, turn }
}

function buildRows(messages: readonly SessionMessageInfo[]) {
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

    const notice = noticeRow(message, range)
    if (message.type === "user" && range) {
      rows.push({
        type: "user",
        key: `${message.id}:user`,
        turn: range.turn,
        userTurn: range.userTurn,
        message,
        answered: isAnswered(messages, index, range, rangeIndex < ranges.length - 1),
      })
    } else if (message.type === "assistant" && range) {
      rows.push(...assistantRows(message, range))
    } else if (notice) {
      rows.push(notice)
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

/**
 * The notice row for a described synthetic message, or undefined when the message has no row. A subagent completion
 * already shows as its tool card and in the agent stack; its synthetic message exists for the model, so a notice row
 * here would only repeat the card title at the end of the transcript. Shell notices keep their row: a backgrounded
 * shell result, a restart, and a shell start failure are only visible there.
 */
function noticeRow(message: SessionMessageInfo, range: MessageTurnRange | undefined) {
  if (!range || message.type !== "synthetic" || !message.description) return undefined
  if (message.metadata?.source === "subagent") return undefined
  // The TUI shows a described synthetic message as one notice; one without a description stays hidden.
  return {
    type: "notice" as const,
    key: `${message.id}:notice`,
    turn: range.turn,
    userTurn: range.userTurn,
    message,
    text: message.description,
  }
}

function assistantRows(message: SessionMessageAssistant, range: MessageTurnRange): TranscriptAssistantRow[] {
  const metadata = range.metadata?.carrierID === message.id ? range.metadata : undefined
  if (message.content.length === 0) {
    return [
      {
        type: "assistant",
        key: `${message.id}:assistant:0`,
        turn: range.turn,
        userTurn: range.userTurn,
        message,
        start: 0,
        parts: [],
        metadata,
      },
    ]
  }
  const rows: TranscriptAssistantRow[] = []
  for (let start = 0; start < message.content.length; start += TRANSCRIPT_CHUNK_SIZE) {
    rows.push({
      type: "assistant",
      key: `${message.id}:assistant:${start}`,
      turn: range.turn,
      userTurn: range.userTurn,
      message,
      start,
      parts: message.content.slice(start, start + TRANSCRIPT_CHUNK_SIZE),
      metadata,
    })
  }
  return rows
}

/**
 * Rows that were direct in the previous update and now belong to the virtual
 * window. They must stay mounted for the handoff so a tall row is not remounted
 * at the estimated size.
 */
export function handedRows(previous: readonly string[] | undefined, indexByKey: ReadonlyMap<string, number>) {
  return (previous ?? []).filter((key) => indexByKey.has(key))
}

/**
 * Offset of a row inside the virtual window. Virtua measures from the start
 * margin and `scrollToIndex` adds it again, so the saved offset excludes it.
 */
export function anchorOffset(scrollOffset: number, startMargin: number, itemOffset: number) {
  return scrollOffset - startMargin - itemOffset
}

/** Scroll position that keeps a row in place when the row area starts lower or higher. */
export function shiftedScroll(scrollTop: number, previousStart: number, nextStart: number) {
  return scrollTop + nextStart - previousStart
}

function splitDirect(rows: readonly TranscriptRow[], direct: ReadonlySet<string>) {
  const turn = rows.at(-1)?.turn
  if (!turn || !direct.has(turn)) return { virtual: rows, direct: [] }
  const start = rows.findIndex((row) => row.turn === turn)
  const boundary = Math.max(start, rows.length - DIRECT_TAIL_ROWS)
  const tail = rows.slice(boundary)
  // The turn has no renderable assistant row yet, so keep it virtualized.
  if (!tail.some((row) => row.type === "assistant")) return { virtual: rows, direct: [] }
  return { virtual: rows.slice(0, boundary), direct: tail }
}

function stepFailed(message: SessionMessageInfo | undefined) {
  return message?.type === "assistant" && !!message.error
}

function isAnswered(
  messages: readonly SessionMessageInfo[],
  index: number,
  range: MessageTurnRange,
  followed: boolean,
) {
  if (followed || messages[range.end]?.type === "idle") return true
  for (let i = index + 1; i < range.end; i++) {
    if (messages[i]?.type === "assistant") return true
  }
  return false
}

function reuseRows(rows: TranscriptRow[], previous?: readonly TranscriptRow[]) {
  if (!previous?.length) return rows
  const prior = new Map(previous.map((row) => [row.key, row]))
  return rows.map((row) => {
    const old = prior.get(row.key)
    return old && sameRow(old, row) ? old : row
  })
}

function sameRow(left: TranscriptRow, right: TranscriptRow) {
  if (left.type !== right.type || left.turn !== right.turn || left.userTurn !== right.userTurn) return false
  if (left.type === "user" && right.type === "user") {
    return left.message === right.message && left.answered === right.answered
  }
  if (left.type === "assistant" && right.type === "assistant") {
    return (
      left.message === right.message &&
      left.start === right.start &&
      sameParts(left.parts, right.parts) &&
      sameMetadata(left.metadata, right.metadata)
    )
  }
  if (left.type === "notice" && right.type === "notice") return left.message === right.message
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
