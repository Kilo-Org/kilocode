export type Activity = "waiting" | "error" | "retry" | "busy" | "done" | "idle"

export type Status = "idle" | "busy" | "retry" | "offline"

export interface ActivityInput {
  status?: Status
  blocked?: boolean
  errored?: boolean
  finished?: boolean
  disconnected?: boolean
}

export function activity(input: ActivityInput): Activity {
  if (input.disconnected && (input.blocked || input.status === "busy" || input.status === "retry")) return "error"
  if (input.blocked) return "waiting"
  if (input.errored || input.status === "offline") return "error"
  if (input.status === "retry") return "retry"
  if (input.status === "busy") return "busy"
  if (input.finished) return "done"
  return "idle"
}

export function activities(input: {
  parents: ReadonlyMap<string, string>
  statuses: Record<string, { type: Status }>
  outcomes: Record<string, { reason: string } | undefined>
  blocked: Iterable<string>
  submitting?: Iterable<string>
  disconnected: boolean
}): Record<string, Activity> {
  const blocked = new Set(input.blocked)
  const submitting = new Set(input.submitting)
  const ids = new Set([...Object.keys(input.statuses), ...Object.keys(input.outcomes), ...blocked, ...submitting])
  const result: Record<string, Activity> = {}
  for (const id of ids) {
    const status = submitting.has(id) ? "busy" : input.statuses[id]?.type
    const close = input.outcomes[id]?.reason
    const active = activity({ status, blocked: blocked.has(id), disconnected: input.disconnected })
    const own = activity({
      status,
      blocked: blocked.has(id),
      disconnected: input.disconnected,
      errored: close === "error",
      finished: close === "completed",
    })
    result[id] = strongest([result[id] ?? "idle", own])
    if (active === "idle") continue
    const seen = new Set([id])
    for (let parent = input.parents.get(id); parent && !seen.has(parent); parent = input.parents.get(parent)) {
      seen.add(parent)
      result[parent] = strongest([result[parent] ?? "idle", active])
    }
  }
  return result
}

export function running(state: Activity): boolean {
  return state === "busy" || state === "retry"
}

const ORDER: Activity[] = ["waiting", "error", "retry", "busy", "done", "idle"]

export function isActivity(value: unknown): value is Activity {
  return typeof value === "string" && ORDER.includes(value as Activity)
}

export function strongest(states: Activity[]): Activity {
  for (const state of ORDER) {
    if (states.includes(state)) return state
  }
  return "idle"
}

const LABELS: Record<Activity, string> = {
  waiting: "task.backgroundAgents.needsInput",
  error: "task.backgroundAgents.status.error",
  retry: "session.status.retry",
  busy: "session.tabs.switcher.busy",
  done: "task.backgroundAgents.status.completed",
  idle: "session.current",
}

export function label(state: Activity): string {
  return LABELS[state]
}
