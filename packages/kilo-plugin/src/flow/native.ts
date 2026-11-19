import { Automation } from "@opencode/core/automation"
import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import type { Session } from "@opencode/schema/session"
import { durationMillis } from "@opencode/schema/automation"
import { parseAt } from "@opencode/schema/kilocode/schedule"
import { DateTime, Option } from "effect"
import { automationID } from "../schedule-id"

export { automationID }

const schedulePrefix = "flow-schedule:v1:"

/** The native automation row that fires a Flow. Its hook prompt is descriptive only: the scheduler never admits it. */
export function backingSchedule(record: KiloFlowRpc.Record, sessionID: Session.ID): Automation.ServiceCreateInput {
  const expires = expiry(record.ends, record.trigger.timezone)
  return {
    sessionID,
    name: `Flow: ${record.name}`,
    trigger: triggerOf(record.trigger.when, record.trigger.timezone),
    ...(expires ? { expires } : {}),
    action: { type: "hook", prompt: record.prompt },
  }
}

export function scheduleKey(scheduleID: KiloFlowRpc.ScheduleID) {
  return `${schedulePrefix}${scheduleID}`
}

/** The pre-2.3.1 storage key for a row the migration renamed from `sch_` to `aut_`. */
export function legacyScheduleKey(scheduleID: KiloFlowRpc.ScheduleID) {
  return `${schedulePrefix}${scheduleID.startsWith("aut_") ? `sch_${scheduleID.slice(4)}` : scheduleID}`
}

/** A Flow's `times` limit, counted against the native row because automation rows only carry a single expiry. */
export function remaining(ends: KiloFlowRpc.Ends | undefined, schedule: Automation.Info) {
  if (ends?.times === undefined) return undefined
  return Math.max(0, ends.times - schedule.runCount)
}

export function time(input: KiloFlowRpc.CreateInput["when"]): KiloFlowRpc.When {
  if (input.in !== undefined) return { type: "in", in: input.in, tz: input.tz }
  if (input.at !== undefined) return { type: "at", at: input.at, tz: input.tz }
  if (input.every !== undefined) return { type: "every", every: input.every, tz: input.tz }
  return { type: "cron", cron: input.cron, tz: input.tz }
}

export function trigger(schedule: Automation.Info): KiloFlowRpc.Trigger {
  const timezone = schedule.tz
  const when = schedule.trigger
  if (when.type === "at") return { type: "time", when: { type: "at", at: when.at, tz: timezone }, timezone }
  if (when.type === "every")
    return { type: "time", when: { type: "every", every: when.every, tz: timezone }, timezone }
  if (when.type === "cron")
    return { type: "time", when: { type: "cron", cron: when.cron, tz: timezone }, timezone }
  // The inventory filters event automations out; a stray row still reads as a labelled time trigger.
  return { type: "time", when: { type: "at", at: `${when.server}:${when.event}`, tz: timezone }, timezone }
}

export function status(value: Automation.Status): KiloFlowRpc.Status {
  if (value === "done") return "completed"
  return value
}

export function instant(value: DateTime.Utc): number
export function instant(value: DateTime.Utc | undefined): number | undefined
export function instant(value: DateTime.Utc | undefined) {
  return value && DateTime.toEpochMillis(value)
}

/** The automation trigger for a Flow's `when`, keeping the Flow's zone. */
function triggerOf(when: KiloFlowRpc.When, timezone: string): Automation.Trigger {
  const tz = when.tz ?? timezone
  if (when.type === "in") return { type: "at", at: `in ${when.in}`, tz }
  if (when.type === "at") return { type: "at", at: when.at, tz }
  if (when.type === "every") return { type: "every", every: when.every, tz }
  return { type: "cron", cron: when.cron, tz }
}

/** Automation rows carry one expiry; a `times` limit is enforced by the Flow claim hook. */
function expiry(ends: KiloFlowRpc.Ends | undefined, timezone: string) {
  if (!ends) return undefined
  // `ends.at` is a wall-clock time in the Flow's zone, so it must be read there rather than as host-local time.
  const at = ends.at === undefined ? undefined : Option.getOrUndefined(parseAt(ends.at, timezone))
  if (ends.at !== undefined && at === undefined) throw new Error(`Invalid ends.at: ${ends.at}`)
  const after =
    ends.after === undefined ? undefined : Date.now() + Option.getOrElse(durationMillis(ends.after), () => 0)
  // The Flow stops at whichever limit comes first, as the RPC documents, so keep the earlier instant.
  const first = at !== undefined && after !== undefined ? Math.min(at, after) : (at ?? after)
  if (first === undefined) return undefined
  return new Date(first).toISOString()
}
