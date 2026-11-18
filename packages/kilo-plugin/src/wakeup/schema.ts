// The wakeup input rules: one-shot times resolve to an absolute instant with the clamps the tools describe, and a
// recurring task expires after the same horizon. The timing itself belongs to the native schedule service; this
// module only decides what the caller asked for.
import { Cron, Result, Schema } from "effect"

/** A `delay` under this is raised to it; an absolute `when` is honored as given, unless it is in the past. */
export const MIN_DELAY_MS = 10_000
/** A wakeup never fires further out than seven days. */
export const MAX_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
/** One session may hold at most this many pending wakeups. */
export const MAX_PER_SESSION = 10
/** One session may hold at most this many scheduled cron tasks. */
export const MAX_CRON_PER_SESSION = 10
/** A scheduled cron task expires seven days after it was created. */
export const CRON_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const Kind = Schema.Literals(["wakeup", "cron"])
export type Kind = typeof Kind.Type

/** The persisted description of one task, keyed by our id, next to the native schedule that fires it. */
export const Record = Schema.Struct({
  id: Schema.String,
  scheduleID: Schema.String,
  kind: Kind,
  sessionID: Schema.String,
  directory: Schema.String,
  prompt: Schema.String,
  reason: Schema.optional(Schema.String),
  created: Schema.Number,
  /** The fire time the tools and clients show. Kept current for a recurring task. */
  dueAt: Schema.Number,
  /** The 5-field expression of a recurring task. */
  schedule: Schema.optional(Schema.String),
})
export type Record = typeof Record.Type
export const decodeRecord = Schema.decodeUnknownOption(Record)

export type TimeInput = { readonly when?: string; readonly delay?: string }

export type TimeError = { readonly message: string; readonly past: boolean }

// ISO-8601 date-time. The offset is optional; when present it is absolute, and when omitted the host timezone applies.
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/
// `30`, `30s`, `5m`, `2h`, `1d`: bare numbers are seconds.
const DELAY = /^\s*(\d+)\s*([smhd])?\s*$/i

export function parseWhen(input: string) {
  if (!WHEN.test(input)) return undefined
  const value = Date.parse(input)
  return Number.isFinite(value) ? value : undefined
}

export function parseDelay(input: string) {
  const match = DELAY.exec(input)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = (match[2] ?? "s").toLowerCase()
  const scale = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000
  return value * scale
}

const present = (value: string | undefined) => (value != null && value !== "" ? value : undefined)

/**
 * Resolve the requested time to an absolute epoch, applying the clamps: exactly one of `when`/`delay`; a past time
 * is rejected; a positive delay below the minimum clamps up to it; anything beyond the horizon clamps down.
 */
export function resolveTime(
  input: TimeInput,
  now = Date.now(),
): { readonly dueAt: number } | { readonly error: TimeError } {
  const when = present(input.when)
  const delay = present(input.delay)
  if ((when !== undefined) === (delay !== undefined))
    return { error: { message: "Provide exactly one of when or delay", past: false } }
  if (when !== undefined) {
    const target = parseWhen(when)
    if (target === undefined) return { error: { message: `Invalid time: ${when}`, past: false } }
    if (target <= now) return { error: { message: `Wakeup time is not in the future: ${when}`, past: true } }
    return { dueAt: Math.min(target, now + MAX_HORIZON_MS) }
  }
  const span = parseDelay(delay!)
  if (span === undefined) return { error: { message: `Invalid delay: ${delay}`, past: false } }
  if (span <= 0) return { error: { message: `Wakeup delay is not in the future: ${delay}`, past: true } }
  return { dueAt: Math.min(Math.max(now + span, now + MIN_DELAY_MS), now + MAX_HORIZON_MS) }
}

/**
 * The clamp that applied to a resolved time, as one model-facing sentence, or undefined when it was honored as
 * given. Tools echo it so the model knows its requested time was adjusted.
 */
export function clampNotice(input: TimeInput, dueAt: number, now = Date.now()) {
  const when = present(input.when)
  const delay = present(input.delay)
  if (when !== undefined && dueAt - now === MAX_HORIZON_MS && (parseWhen(when) ?? 0) > now + MAX_HORIZON_MS)
    return `Requested when: "${when}" is beyond the 7-day horizon and was pulled back to it.`
  if (delay === undefined) return undefined
  const span = parseDelay(delay)
  if (span === undefined) return undefined
  if (span < MIN_DELAY_MS && dueAt - now === MIN_DELAY_MS)
    return `Requested delay: "${delay}" is under the 10-second minimum and was raised to it.`
  if (span > MAX_HORIZON_MS && dueAt - now === MAX_HORIZON_MS)
    return `Requested delay: "${delay}" is beyond the 7-day horizon and was pulled back to it.`
  return undefined
}

/** Whole-unit countdown to the due time, e.g. `in 5m`. */
export function relative(dueAt: number, now: number) {
  const delta = Math.max(0, dueAt - now)
  if (delta < 60_000) return `in ${Math.max(1, Math.round(delta / 1_000))}s`
  // Promote the rounded unit so a one-hour wait reads "1h", not "60m".
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(delta / 3_600_000)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(delta / 86_400_000)}d`
}

/** Collapse whitespace and clip to `max` characters with an ellipsis. */
export function excerpt(text: string, max = 80) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** The next occurrence of a recurring record, so the last fire can retire it. */
export function nextOccurrence(cron: string, tz: string, now: number): number | undefined {
  const parsed = Cron.parse(cron, tz)
  if (Result.isFailure(parsed)) return undefined
  return Cron.next(parsed.success, now + 1).getTime()
}
