// What a session is doing, as the Agent Manager sidebar, tabs and terminals show it. Computed from the v2 store of the
// session's directory: execution status, pending permissions and forms, a scheduled retry, the last outcome and
// whether its idle transition was viewed.
import type { SessionInfo } from "@opencode/client"
import type { Data } from "@opencode/client/solid"

export type Activity = "waiting" | "error" | "retry" | "busy" | "done" | "scheduled" | "idle"

const STATES: Activity[] = ["scheduled", "done", "busy", "retry", "error", "waiting"]

const LABELS: Record<Activity, string> = {
  waiting: "task.backgroundAgents.needsInput",
  error: "task.backgroundAgents.status.error",
  retry: "session.status.retry",
  busy: "session.tabs.switcher.busy",
  done: "task.backgroundAgents.status.completed",
  scheduled: "session.tabs.switcher.scheduled",
  idle: "session.current",
}

export function score(state: Activity) {
  return STATES.indexOf(state) + 1
}

export function strongest(states: Activity[]): Activity {
  return states.reduce<Activity>((best, state) => (score(state) > score(best) ? state : best), "idle")
}

export function running(state: Activity) {
  return state === "busy" || state === "retry"
}

export function isActivity(value: unknown): value is Activity {
  return value === "idle" || STATES.some((state) => state === value)
}

export function label(state: Activity) {
  return LABELS[state]
}

export function description(state: Activity) {
  return `session.activity.${state}`
}

/**
 * The activity of one session and its subagents. A subagent that waits or runs lifts its root; a finished subagent
 * does not. `connected` false turns a running or waiting session into an error, because its state is unknown.
 */
export function sessionActivity(data: Data, sessionID: string, connected: boolean): Activity {
  const family = [sessionID, ...data.session.family(sessionID).filter((id) => id !== sessionID)]
  const live = family.map((id) => liveActivity(data, id, connected))
  return strongest([...live, ownOutcome(data, sessionID)])
}

function liveActivity(data: Data, sessionID: string, connected: boolean): Activity {
  const blocked =
    (data.session.permission.list(sessionID)?.length ?? 0) > 0 || (data.session.form.list(sessionID)?.length ?? 0) > 0
  const status = data.session.status(sessionID)
  if (!connected && (blocked || status === "running")) return "error"
  if (blocked) return "waiting"
  if (status !== "running") return "idle"
  const step = data.session.message.list(sessionID).findLast((item) => item.type === "assistant")
  return step?.type === "assistant" && step.retry ? "retry" : "busy"
}

function ownOutcome(data: Data, sessionID: string): Activity {
  const info = data.session.get(sessionID)
  if (!info || data.session.status(sessionID) === "running") return "idle"
  return activityOf(info)
}

/** The finished state a session record keeps: used when its store has not loaded the session yet. */
export function activityOf(info: Pick<SessionInfo, "outcome" | "time">): Activity {
  if (info.outcome === "failed") return "error"
  const idle = info.time.idle
  if (info.outcome === "succeeded" && idle !== undefined && (info.time.viewed ?? 0) < idle) return "done"
  return "idle"
}
