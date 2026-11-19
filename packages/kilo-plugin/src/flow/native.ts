import { Automation } from "@opencode/core/automation"
import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import type { Session } from "@opencode/schema/session"
import { DateTime } from "effect"

const schedulePrefix = "flow-schedule:v1:"

/** The native automation row that fires a Flow. Its hook prompt is descriptive only: the scheduler never admits it. */
export function backingSchedule(record: KiloFlowRpc.Record, sessionID: Session.ID): Automation.CreateInput {
  const expires = expiry(record.ends)
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

/** Stored backing ids may predate automation's `aut_` prefix; the service only needs the brand at its boundary. */
export function automationID(id: KiloFlowRpc.ScheduleID): Automation.ID {
  return Automation.ID.make(id)
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
function expiry(ends: KiloFlowRpc.Ends | undefined) {
  if (!ends) return undefined
  if (ends.at) return ends.at
  if (ends.after) return `in ${ends.after}`
  return undefined
}
