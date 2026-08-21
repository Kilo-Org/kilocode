import type { Message, Part } from "../types/messages"
import { category, settled } from "../components/chat/tool-activity"
import { visibleParts, type MessageTurn, type RevertBoundary } from "./session-queue"

interface TranscriptMeta {
  turn: string
  partial: boolean
  queued: boolean
  live: boolean
}

export interface TranscriptUserRow extends TranscriptMeta {
  type: "user"
  key: string
  message: Message
  parts: Part[]
  interrupted: boolean
  answered: boolean
}

export interface TranscriptAssistantRow extends TranscriptMeta {
  type: "assistant"
  key: string
  message: Message
  parts: Part[]
  copy?: string
}

export interface TranscriptActivityItem {
  key: string
  message: Message
  part: Part
}

export interface TranscriptActivityRow extends TranscriptMeta {
  type: "activity"
  key: string
  items: TranscriptActivityItem[]
  /** True while this activity, rather than only its turn, is still active. */
  working: boolean
}

export interface TranscriptDiffRow extends TranscriptMeta {
  type: "diff"
  key: string
  message: Message
  diffs: unknown[]
}

export interface TranscriptErrorRow extends TranscriptMeta {
  type: "error"
  key: string
  message: Message
  error: NonNullable<Message["error"]>
}

export type TranscriptRow =
  | TranscriptUserRow
  | TranscriptAssistantRow
  | TranscriptActivityRow
  | TranscriptDiffRow
  | TranscriptErrorRow

export interface TranscriptOptions {
  size?: number
  /**
   * Compact tool activity. The agent emits one assistant message per step, so a
   * run of tool calls is spread across many messages and therefore many rows.
   * Grouping inside a single row would only ever see one or two parts, so rows
   * whose parts are all groupable are coalesced here first.
   */
  compact?: boolean
  /**
   * The same predicate AssistantMessage renders with. Rows carry bookkeeping parts
   * such as `step-start` that never reach the DOM, and treating one of those as a
   * blocker would stop every run from coalescing.
   */
  renderable?: (part: Part, message: Message) => boolean
  queued?: ReadonlySet<string>
  live?: ReadonlySet<string>
  hidden?: (id: string) => boolean
  revert?: RevertBoundary
}

export interface TranscriptPartition {
  virtual: TranscriptRow[]
  direct: TranscriptRow[]
  queued: TranscriptRow[]
}

export interface TranscriptHold {
  sid: string
  turn: string
}

export function retainTurn(
  prev: TranscriptHold | undefined,
  sid: string | undefined,
  turn: string | undefined,
  paused: boolean,
) {
  if (!sid) return undefined
  if (!turn || paused) return prev?.sid === sid ? prev : turn ? { sid, turn } : undefined
  if (prev?.sid === sid && prev.turn === turn) return prev
  return { sid, turn }
}

function same<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function meta(a: TranscriptRow, b: TranscriptRow) {
  return a.turn === b.turn && a.partial === b.partial && a.queued === b.queued && a.live === b.live
}

function sameActivity(a: TranscriptActivityRow, b: TranscriptActivityRow) {
  if (a.working !== b.working || a.items.length !== b.items.length) return false
  return a.items.every((item, index) => {
    const other = b.items[index]
    return item.message === other?.message && item.part === other.part
  })
}

function shareActivity(row: TranscriptActivityRow, prev: TranscriptActivityRow) {
  const prior = new Map(prev.items.map((item) => [item.key, item]))
  row.items = row.items.map((item) => {
    const old = prior.get(item.key)
    return old?.message === item.message && old.part === item.part ? old : item
  })
}

function equal(a: TranscriptRow, b: TranscriptRow) {
  if (a.type !== b.type || !meta(a, b)) return false
  if (a.type === "user" && b.type === "user") {
    return (
      a.message === b.message && same(a.parts, b.parts) && a.interrupted === b.interrupted && a.answered === b.answered
    )
  }
  if (a.type === "assistant" && b.type === "assistant") {
    return a.message === b.message && same(a.parts, b.parts) && a.copy === b.copy
  }
  if (a.type === "activity" && b.type === "activity") {
    return sameActivity(a, b)
  }
  if (a.type === "diff" && b.type === "diff") {
    return a.message === b.message && same(a.diffs, b.diffs)
  }
  if (a.type === "error" && b.type === "error") {
    return a.message === b.message && a.error === b.error
  }
  return false
}

function diffs(msg: Message) {
  if (!msg.summary || typeof msg.summary === "boolean") return []
  return msg.summary.diffs ?? []
}

function copy(messages: Message[], getParts: (id: string) => Part[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = getParts(messages[i]!.id)
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (part?.type !== "text" || part.synthetic || !part.text.trim()) continue
      return part.id
    }
  }
  return undefined
}

export function transcriptRows(
  turns: MessageTurn[],
  getParts: (id: string) => Part[],
  opts: TranscriptOptions = {},
  prev: TranscriptRow[] = [],
): TranscriptRow[] {
  const size = Math.max(1, Math.floor(opts.size ?? 8))
  const rows: TranscriptRow[] = []
  const parts = (id: string) => visibleParts(id, getParts(id), opts.revert)
  const terminal = (msg: Message) => !(opts.revert?.partID && msg.id === opts.revert.messageID)

  for (const turn of turns) {
    const meta = {
      turn: turn.id,
      partial: turn.partial === true,
      queued: opts.queued?.has(turn.id) === true,
      live: opts.live?.has(turn.id) === true,
    }
    const copied = copy(turn.assistant, parts)

    if (!turn.partial) {
      rows.push({
        ...meta,
        type: "user",
        key: `${turn.id}:user`,
        message: turn.user,
        parts: parts(turn.user.id),
        interrupted: turn.assistant.some((msg) => terminal(msg) && msg.error?.name === "MessageAbortedError"),
        answered: turn.assistant.length > 0,
      })
    }

    for (const msg of turn.assistant) {
      const visible = parts(msg.id)
      if (visible.length === 0) {
        rows.push({
          ...meta,
          type: "assistant",
          key: `${turn.id}:assistant:${msg.id}:empty`,
          message: msg,
          parts: visible,
          copy: copied,
        })
        continue
      }
      for (let start = 0; start < visible.length; start += size) {
        const chunk = visible.slice(start, start + size)
        rows.push({
          ...meta,
          type: "assistant",
          key: `${turn.id}:assistant:${msg.id}:${chunk[0]!.id}`,
          message: msg,
          parts: chunk,
          copy: copied,
        })
      }
    }

    const changes = diffs(turn.user)
    if (changes.length > 0) {
      rows.push({ ...meta, type: "diff", key: `${turn.id}:diff`, message: turn.user, diffs: changes })
    }

    const failed = turn.assistant.find(
      (msg) => terminal(msg) && msg.error && msg.error.name !== "MessageAbortedError" && opts.hidden?.(msg.id) !== true,
    )
    if (failed?.error) {
      rows.push({ ...meta, type: "error", key: `${turn.id}:error:${failed.id}`, message: failed, error: failed.error })
    }
  }

  const merged = opts.compact ? coalesce(rows, opts.renderable ?? (() => true)) : rows

  if (prev.length === 0) return merged
  const prior = new Map(prev.map((row) => [row.key, row]))
  return merged.map((row) => {
    const old = prior.get(row.key)
    if (row.type === "activity" && old?.type === "activity") shareActivity(row, old)
    return old && equal(old, row) ? old : row
  })
}

/**
 * Turn groupable assistant parts into explicit activity rows. Each item keeps its
 * real owning message, so rendering a run across assistant messages never lends
 * every part the first message's identity.
 *
 * This works at part level rather than row level. A text or standalone tool ends
 * the current activity, but groupable parts before and after it still get their
 * own stable rows even when all three happen to share one transcript chunk.
 */
function coalesce(rows: TranscriptRow[], renderable: (part: Part, message: Message) => boolean): TranscriptRow[] {
  const out: TranscriptRow[] = []
  let run: TranscriptActivityItem[] = []
  let base: TranscriptMeta | undefined

  const flush = () => {
    if (run.length === 0) return
    const first = run[0]!
    out.push({
      ...base!,
      type: "activity",
      key: `${base!.turn}:activity:${first.part.id}`,
      items: run.slice(),
      working: run.some((item) => !settled(item.part as never)),
    })
    run = []
    base = undefined
  }

  for (const row of rows) {
    if (row.type !== "assistant") {
      flush()
      out.push(row)
      continue
    }

    const shown = row.parts.filter((part) => renderable(part, row.message))
    // A new assistant step can exist briefly before its first visible part. It
    // contributes no DOM, so it must not split the trailing activity and make the
    // summary disappear and return between subagent events.
    if (shown.length === 0) continue

    const loose: Part[] = []
    const emit = () => {
      if (loose.length === 0) return
      out.push({
        ...row,
        key: `${row.turn}:assistant:${row.message.id}:${loose[0]!.id}`,
        parts: loose.splice(0),
      })
    }
    for (const part of shown) {
      if (category(part as never)) {
        emit()
        if (base && base.turn !== row.turn) flush()
        base ??= {
          turn: row.turn,
          partial: row.partial,
          queued: row.queued,
          live: row.live,
        }
        base.partial ||= row.partial
        base.queued ||= row.queued
        base.live ||= row.live
        run.push({ key: part.id, message: row.message, part })
        continue
      }

      flush()
      loose.push(part)
    }
    emit()
  }
  flush()

  // A turn remains live in the gap between one completed tool and the next tool
  // part arriving. Keep only its trailing activity present-tense through that
  // gap; an activity followed by text or another standalone surface is finished.
  for (let index = 0; index < out.length; index += 1) {
    const row = out[index]
    if (row?.type !== "activity" || row.working || !row.live) continue
    const later = out.slice(index + 1).some((item) => item.turn === row.turn)
    if (!later) row.working = true
  }
  return out
}

export function partitionRows(rows: TranscriptRow[], direct: ReadonlySet<string> = new Set()): TranscriptPartition {
  const queued = rows.filter((row) => row.queued)
  const visible = rows.filter((row) => !row.queued)
  const turn = visible.at(-1)?.turn
  // Only the latest visible turn can render directly.
  if (!turn || !direct.has(turn)) return { virtual: visible, direct: [], queued }

  let boundary = -1
  let activity = false
  for (let i = 0; i < visible.length; i += 1) {
    const row = visible[i]!
    if (row.turn !== turn) continue
    // Keep the whole compact activity suffix outside Virtua until the turn hands
    // off. Moving a settled activity into the virtualizer when final text starts
    // would unmount and remount the summary at the most visible moment.
    if (row.type === "activity") {
      if (boundary === -1) boundary = i
      activity = true
      continue
    }
    if (row.type === "assistant" && !activity) boundary = i
  }

  // The selected turn has no renderable assistant row.
  if (boundary === -1) return { virtual: visible, direct: [], queued }

  // Boundary starts the direct suffix, preserving rows after the streaming assistant.
  return {
    virtual: visible.slice(0, boundary),
    direct: visible.slice(boundary),
    queued,
  }
}
