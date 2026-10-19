import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import { Config } from "@/config/config"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { GoalPolicy } from "@/kilocode/session/goal/policy"
import type { Wakeup } from "@/kilocode/wakeup"
import { KiloHooks } from "./hooks"
import { KiloHookPayload } from "./payload"

// Kilo-only unattended events: GoalReport (before a /goal settles on the model's report) and
// WakeupFire (before a scheduled wakeup or cron occurrence runs). Neither can open a prompt.

type Services = {
  config: Config.Interface
  database: Database.Interface
  sessions: Pick<Session.Interface, "get">
  /** Where notices are published; the EventV2Bridge in context otherwise. */
  events?: EventV2.Interface
}

/** GoalReport rejections in one goal run before the goal pauses instead of retrying (loop cap). */
export const REJECTIONS = 3

export type Report = { retry?: string; pause?: string; context: string }
export type Wake = { skip?: string; context: string }

function resolve(sessionID: SessionID, event: KiloHooks.Event, services: Services) {
  return KiloHooks.resolve(sessionID, event).pipe(
    Effect.provideService(Config.Service, services.config),
    Effect.provideService(Database.Service, services.database),
  )
}

function why(value: string) {
  return value.trim() || "No reason given."
}

/**
 * GoalReport before a goal settles on the working model's report. `retry` runs another goal turn
 * with that note, `pause` settles the goal as paused, `context` is appended to the settled reason.
 * A failing hook never forces another turn (onFailure is not honored on this event).
 */
export const goal = Effect.fn("KiloHookUnattended.goal")(function* (
  input: {
    sessionID: SessionID
    /** Session directory: the hook's working directory. */
    cwd: string
    text: string
    report: GoalPolicy.Report
    /** Consecutive rejections so far in this goal run. */
    attempt: number
    agent?: string
  } & Services,
) {
  const hooks = yield* resolve(input.sessionID, "GoalReport", input)
  if (!KiloHooks.select(hooks, "GoalReport", [input.report.status]).length) return report(undefined, input.attempt)
  const root = yield* KiloHookPayload.root(input.sessionID, input.sessions)
  const verdict = yield* KiloHooks.fire({
    event: "GoalReport",
    hooks,
    subjects: [input.report.status],
    payloads: [
      {
        ...KiloHookPayload.base("GoalReport", {
          sessionID: input.sessionID,
          root,
          cwd: input.cwd,
          agent: input.agent,
        }),
        goal: input.text,
        reported_status: input.report.status,
        reason: input.report.reason,
        report_hook_active: input.attempt > 0,
        attempt: input.attempt,
      },
    ],
    cwd: input.cwd,
    sessionID: input.sessionID,
    events: input.events,
  })
  return report(verdict, input.attempt)
})

/**
 * What a GoalReport verdict does to the goal: `continue: false` pauses it, a block retries with the
 * reason until the third consecutive rejection pauses it, context is appended to the settled reason.
 */
export function report(
  verdict: Pick<KiloHooks.Verdict, "block" | "stop" | "context"> | undefined,
  attempt: number,
): Report {
  if (!verdict) return { context: "" }
  if (verdict.stop !== undefined)
    return { pause: `GoalReport hook stopped the goal: ${why(verdict.stop)}`, context: "" }
  if (verdict.block !== undefined && attempt + 1 >= REJECTIONS)
    return { pause: `GoalReport hook rejected the report ${REJECTIONS} times: ${verdict.block}`, context: "" }
  if (verdict.block !== undefined) return { retry: `GoalReport hook feedback: ${verdict.block}`, context: "" }
  return { context: verdict.context.length ? `\n\nHook: ${verdict.context.join("\n\n")}` : "" }
}

/**
 * WakeupFire before a wakeup or cron occurrence prompts its session. `skip` drops this occurrence
 * (a block, `continue: false`, or a failing hook set to block); `context` is appended to the wake text.
 */
export const wake = Effect.fn("KiloHookUnattended.wake")(function* (
  input: {
    info: Wakeup.Info
    kind?: "wakeup" | "cron"
    session?: Session.Info
    /** The fire resumes a waiting goal. */
    goal: boolean
  } & Services,
) {
  const kind = input.kind === "cron" ? "cron" : "once"
  const hooks = yield* resolve(input.info.sessionID, "WakeupFire", input)
  if (!KiloHooks.select(hooks, "WakeupFire", [kind]).length) return skipped(undefined)
  const cwd = input.session?.directory ?? input.info.directory
  const root = yield* KiloHookPayload.root(input.info.sessionID, input.sessions)
  const verdict = yield* KiloHooks.fire({
    event: "WakeupFire",
    hooks,
    subjects: [kind],
    payloads: [
      {
        ...KiloHookPayload.base("WakeupFire", {
          sessionID: input.info.sessionID,
          root,
          cwd,
          agent: input.info.agent,
        }),
        kind,
        wakeup_id: input.info.id,
        prompt: input.info.prompt,
        due_at: new Date(input.info.dueAt).toISOString(),
        goal_linked: input.goal,
      },
    ],
    cwd,
    sessionID: input.info.sessionID,
    events: input.events,
  })
  return skipped(verdict)
})

/** What a WakeupFire verdict does: a block or `continue: false` skips the occurrence; context joins the wake text. */
export function skipped(verdict: Pick<KiloHooks.Verdict, "block" | "stop" | "context"> | undefined): Wake {
  if (!verdict) return { context: "" }
  if (verdict.block !== undefined) return { skip: verdict.block, context: "" }
  if (verdict.stop !== undefined) return { skip: why(verdict.stop), context: "" }
  return { context: verdict.context.length ? `\n\n${KiloHooks.wrap("WakeupFire", verdict.context)}` : "" }
}

// Waits whose last fire a WakeupFire hook skipped while a goal turn of the session ran, with the
// pause reason. That turn may be about to wait on one of them, which would then never end, so the
// goal runner checks them before it suspends.
const drops = new Map<string, Map<string, string>>()

/** Records that a WakeupFire hook skipped the last fire of wait `id` while a goal turn ran. */
export function drop(sessionID: string, id: string, reason: string) {
  const list = drops.get(sessionID) ?? new Map<string, string>()
  list.set(id, reason)
  drops.set(sessionID, list)
}

/**
 * Reads and clears the session's skipped waits, returning the pause reason recorded for wait `id`.
 * Without `id` it only clears them (a new goal turn starts).
 */
export function dropped(sessionID: string, id?: string) {
  const list = drops.get(sessionID)
  drops.delete(sessionID)
  if (id === undefined) return undefined
  return list?.get(id)
}

export * as KiloHookUnattended from "./unattended"
