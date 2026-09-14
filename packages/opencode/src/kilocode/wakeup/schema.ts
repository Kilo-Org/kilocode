import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { Context, Effect, Schema, Types } from "effect"
import z from "zod"

/** A `delay` under this is raised to it; an absolute `when` is honored as given. */
export const MIN_DELAY_MS = 10_000
/** A scheduled wakeup never fires further out than seven days. */
export const MAX_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
/** One session may hold at most this many pending wakeups. */
export const MAX_PER_SESSION = 10

const idSchema = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("wku") }).pipe(
  Schema.brand("WakeupID"),
)
export type ID = typeof idSchema.Type
export const ID = idSchema.pipe(
  withStatics((schema: typeof idSchema) => ({
    ascending: (id?: string) => {
      if (id && !id.startsWith("wku")) throw new Error(`Wakeup ID must start with wku: ${id}`)
      return schema.make(id ?? Identifier.create("wku", "ascending"))
    },
    zod: zod(schema),
  })),
)

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  directory: Schema.String,
  prompt: Schema.String,
  reason: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
  dueAt: NonNegativeInt,
  created: NonNegativeInt,
})
  .annotate({ identifier: "WakeupInfo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Input = Schema.Struct({
  sessionID: SessionID,
  directory: Schema.String,
  prompt: Schema.String,
  when: optionalOmitUndefined(Schema.String),
  delay: optionalOmitUndefined(Schema.String),
  reason: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
})
  .annotate({ identifier: "WakeupInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Input = Types.DeepMutable<Schema.Schema.Type<typeof Input>>

/** Neither a usable `when` nor a usable `delay` was supplied. */
export class InvalidTime extends Schema.TaggedErrorClass<InvalidTime>()("Wakeup.InvalidTime", {
  message: Schema.String,
}) {}

/** The requested time is at or before now. */
export class PastTime extends Schema.TaggedErrorClass<PastTime>()("Wakeup.PastTime", {
  message: Schema.String,
}) {}

/** The session already holds the maximum number of pending wakeups. */
export class TooMany extends Schema.TaggedErrorClass<TooMany>()("Wakeup.TooMany", {
  message: Schema.String,
}) {}

/** The resume boundary: the service fires through this so tests can stub it. */
export class Fire extends Context.Service<
  Fire,
  { readonly run: (info: Info, options?: { inPlace?: boolean }) => Effect.Effect<void> }
>()("@kilocode/WakeupFire") {}

// ISO-8601 date-time. The offset is optional; when present it is absolute, and
// when omitted `Date.parse` interprets the wall clock in the host timezone.
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/
// `30`, `30s`, `5m`, `2h`, `1d` — bare numbers are seconds.
const DELAY = /^\s*(\d+)\s*([smhd])?\s*$/i

function parseWhen(input: string) {
  if (!WHEN.test(input)) return undefined
  const value = Date.parse(input)
  return Number.isFinite(value) ? value : undefined
}

function parseDelay(input: string) {
  const match = DELAY.exec(input)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = (match[2] ?? "s").toLowerCase()
  const scale = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000
  return value * scale
}

/**
 * Resolve the requested time to an absolute epoch, applying the clamps:
 * exactly one of `when`/`delay`; a past time is rejected; a positive delay
 * below the minimum clamps up to it; anything beyond the horizon clamps down.
 */
export function resolve(
  input: { when?: string; delay?: string },
  now = Date.now(),
): Effect.Effect<number, InvalidTime | PastTime> {
  const when = input.when != null && input.when !== "" ? input.when : undefined
  const delay = input.delay != null && input.delay !== "" ? input.delay : undefined
  if ((when !== undefined) === (delay !== undefined)) {
    return Effect.fail(new InvalidTime({ message: "Provide exactly one of when or delay" }))
  }
  if (when !== undefined) {
    const target = parseWhen(when)
    if (target === undefined) return Effect.fail(new InvalidTime({ message: `Invalid time: ${when}` }))
    if (target <= now) return Effect.fail(new PastTime({ message: `Wakeup time is not in the future: ${when}` }))
    return Effect.succeed(Math.min(target, now + MAX_HORIZON_MS))
  }
  const span = parseDelay(delay as string)
  if (span === undefined) return Effect.fail(new InvalidTime({ message: `Invalid delay: ${delay}` }))
  if (span <= 0) return Effect.fail(new PastTime({ message: `Wakeup delay is not in the future: ${delay}` }))
  return Effect.succeed(Math.min(Math.max(now + span, now + MIN_DELAY_MS), now + MAX_HORIZON_MS))
}

/**
 * The clamp that applied to a resolved schedule, as one model-facing sentence,
 * or undefined when the request was honored as given. Tools echo it so the
 * model knows its requested time was adjusted.
 */
export function clampNotice(
  input: { when?: string; delay?: string },
  dueAt: number,
  now = Date.now(),
): string | undefined {
  const when = input.when != null && input.when !== "" ? input.when : undefined
  const delay = input.delay != null && input.delay !== "" ? input.delay : undefined
  if (when !== undefined && dueAt - now === MAX_HORIZON_MS && (parseWhen(when) ?? 0) > now + MAX_HORIZON_MS) {
    return `Requested when: "${when}" is beyond the 7-day horizon and was pulled back to it.`
  }
  if (delay === undefined) return undefined
  const span = parseDelay(delay)
  if (span === undefined) return undefined
  if (span < MIN_DELAY_MS && dueAt - now === MIN_DELAY_MS) {
    return `Requested delay: "${delay}" is under the 10-second minimum and was raised to it.`
  }
  if (span > MAX_HORIZON_MS && dueAt - now === MAX_HORIZON_MS) {
    return `Requested delay: "${delay}" is beyond the 7-day horizon and was pulled back to it.`
  }
  return undefined
}
