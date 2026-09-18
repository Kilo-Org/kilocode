import type { Message, Part } from "../types/messages"
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

/**
 * Wall-clock finish time and duration for a completed turn, shown as the
 * turn's chat-line timestamp.
 */
export interface TurnTiming {
  completedAt: number
  durationMs?: number
}

export interface TranscriptAssistantRow extends TranscriptMeta {
  type: "assistant"
  key: string
  message: Message
  parts: Part[]
  copy?: string
  timing?: TurnTiming
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

export type TranscriptRow = TranscriptUserRow | TranscriptAssistantRow | TranscriptDiffRow | TranscriptErrorRow

export interface TranscriptOptions {
  size?: number
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

function sameTiming(a?: TurnTiming, b?: TurnTiming) {
  return a?.completedAt === b?.completedAt && a?.durationMs === b?.durationMs
}

function equal(a: TranscriptRow, b: TranscriptRow) {
  if (a.type !== b.type || !meta(a, b)) return false
  if (a.type === "user" && b.type === "user") {
    return (
      a.message === b.message && same(a.parts, b.parts) && a.interrupted === b.interrupted && a.answered === b.answered
    )
  }
  if (a.type === "assistant" && b.type === "assistant") {
    return a.message === b.message && same(a.parts, b.parts) && a.copy === b.copy && sameTiming(a.timing, b.timing)
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

/**
 * Finish time and duration for a settled turn, derived the same way as the
 * TUI session view: the last assistant message's completion time minus the
 * user prompt's creation time. Mirrors the TUI's finish guard, because
 * `time.completed` is also set on `tool-calls` steps, and skips partial
 * (not-yet-parented) turns whose synthetic user message reuses an assistant
 * timestamp.
 */
function turnTiming(turn: MessageTurn) {
  if (turn.partial) return undefined
  const last = turn.assistant.at(-1)
  if (!last?.finish || last.finish === "tool-calls" || last.finish === "unknown") return undefined
  const end = last.time?.completed
  if (typeof end !== "number") return undefined
  const start = turn.user.time?.created
  if (typeof start !== "number") return { completedAt: end }
  return { completedAt: end, durationMs: Math.max(0, end - start) }
}

/**
 * Attach turn timing to the row whose action row carries the copy button,
 * because that is where it renders rather than on the turn's last row: the
 * copy part can sit in an earlier chunk, and a tool-only or empty trailing
 * message has no action row at all. Only the current turn's assistant rows are
 * scanned, and the lookup is skipped when there is no timing to show, so the
 * per-part streaming path stays cheap.
 */
function attachTiming(rows: TranscriptAssistantRow[], copied: string | undefined, timing: TurnTiming | undefined) {
  if (!timing || !copied) return
  const owner = rows.find((row) => row.parts.some((part) => part.id === copied))
  if (owner) owner.timing = timing
}

function content(parts: Part[]) {
  const text = parts.find((part) => part.type === "text" && !part.synthetic)
  if (text?.type === "text" && text.text.trim()) return true
  return parts.some(
    (part) => part.type === "file" && (part.mime.startsWith("image/") || part.mime === "application/pdf"),
  )
}

function copy(messages: Message[], getParts: (id: string) => Part[], live: boolean) {
  // While the session streams, the last non-empty text part changes at every
  // part boundary and the copy/feedback row would hop between parts (mount/
  // unmount churn next to the streamed text). Anchor it only once idle.
  if (live) return undefined
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
    const copied = copy(turn.assistant, parts, meta.live)
    const user = turn.partial ? [] : parts(turn.user.id)

    if (!turn.partial && (!meta.queued || content(user))) {
      rows.push({
        ...meta,
        type: "user",
        key: `${turn.id}:user`,
        message: turn.user,
        parts: user,
        interrupted: turn.assistant.some((msg) => terminal(msg) && msg.error?.name === "MessageAbortedError"),
        answered: turn.assistant.length > 0,
      })
    }

    const assistant: TranscriptAssistantRow[] = []
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
        const row: TranscriptAssistantRow = {
          ...meta,
          type: "assistant",
          key: `${turn.id}:assistant:${msg.id}:${chunk[0]!.id}`,
          message: msg,
          parts: chunk,
          copy: copied,
        }
        assistant.push(row)
        rows.push(row)
      }
    }

    attachTiming(assistant, copied, turnTiming(turn))

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

  if (prev.length === 0) return rows
  const prior = new Map(prev.map((row) => [row.key, row]))
  return rows.map((row) => {
    const old = prior.get(row.key)
    return old && equal(old, row) ? old : row
  })
}

export function partitionRows(rows: TranscriptRow[], direct: ReadonlySet<string> = new Set()): TranscriptPartition {
  const queued = rows.filter((row) => row.queued)
  const visible = rows.filter((row) => !row.queued)
  const turn = visible.at(-1)?.turn
  // Only the latest visible turn can render directly.
  if (!turn || !direct.has(turn)) return { virtual: visible, direct: [], queued }

  // The selected turn has no renderable assistant row.
  if (!visible.some((row) => row.turn === turn && row.type === "assistant")) {
    return { virtual: visible, direct: [], queued }
  }

  // The whole live turn renders directly. Handing each finished step to the
  // virtualizer mid-turn mounted those rows at the 260px estimate while their
  // real height (a collapsed tool row is ~28px) was only known once measured;
  // the correction fought the bottom pin and rows near the range edge blinked
  // in and out of the DOM. One handoff happens when the next turn starts.
  const boundary = visible.findIndex((row) => row.turn === turn)

  return {
    virtual: visible.slice(0, boundary),
    direct: visible.slice(boundary),
    queued,
  }
}
