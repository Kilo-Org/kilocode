import type { GoalLink } from "./link"

/** A persisted goal wait survives the status mapping only as a record shape we understand. */
function asWait(value: unknown): GoalLink.Wait | undefined {
  if (!value || typeof value !== "object") return undefined
  if (!("kind" in value) || !("id" in value) || typeof value.id !== "string") return undefined
  if (value.kind !== "wakeup" && value.kind !== "cron" && value.kind !== "process") return undefined
  const dueAt = "dueAt" in value && typeof value.dueAt === "number" ? value.dueAt : undefined
  const recurring = "recurring" in value && typeof value.recurring === "boolean" ? value.recurring : undefined
  return {
    kind: value.kind,
    id: value.id,
    label: "label" in value && typeof value.label === "string" ? value.label : value.id,
    ...(dueAt !== undefined ? { dueAt } : {}),
    ...(recurring !== undefined ? { recurring } : {}),
  }
}

export namespace GoalState {
  export type Status = "active" | "complete" | "blocked" | "paused" | "waiting"
  type Token = { cancel?: () => void }
  const runs = new Map<string, Token>()
  const pending = new Map<string, Token>()
  const holds = new Set<string>()
  const curbs = new Set<string>()

  export function prepare(id: string, cancel?: () => void) {
    const previous = pending.get(id)
    const token = { cancel }
    pending.set(id, token)
    previous?.cancel?.()
    const current = () => pending.get(id) === token
    return {
      current,
      release: () => {
        if (current()) pending.delete(id)
      },
    }
  }

  export function read(metadata?: Record<string, unknown> | null) {
    const goal = metadata?.["kilo.goal"]
    if (!goal || typeof goal !== "object" || !("text" in goal) || typeof goal.text !== "string" || !goal.text.trim()) {
      return undefined
    }
    const status: Status =
      "status" in goal &&
      (goal.status === "active" ||
        goal.status === "complete" ||
        goal.status === "blocked" ||
        goal.status === "paused" ||
        goal.status === "waiting")
        ? goal.status
        : "active" in goal && goal.active === true
          ? "active"
          : "paused"
    const reason = "reason" in goal && typeof goal.reason === "string" ? goal.reason : undefined
    const wait = "wait" in goal ? asWait(goal.wait) : undefined
    return {
      text: goal.text,
      status,
      active: status === "active",
      ...(reason ? { reason } : {}),
      ...(wait ? { wait } : {}),
    }
  }

  export function start(id: string, cancel?: () => void) {
    clearWaiting(id)
    clearCurb(id)
    const previous = runs.get(id)
    const token = { cancel }
    runs.set(id, token)
    previous?.cancel?.()
    return () => runs.get(id) === token
  }

  export function pause(id: string, preserve = false) {
    clearWaiting(id)
    clearCurb(id)
    if (!preserve) {
      const token = pending.get(id)
      pending.delete(id)
      token?.cancel?.()
    }
    const token = runs.get(id)
    const active = runs.delete(id)
    token?.cancel?.()
    return active
  }

  export function active(id: string) {
    return runs.has(id)
  }

  export function markWaiting(id: string) {
    holds.add(id)
  }

  /** A wait-for-deploy goal may only call the scheduling tools until it arms a wait. */
  export function curb(id: string) {
    curbs.add(id)
  }

  export function clearCurb(id: string) {
    curbs.delete(id)
  }

  export function curbed(id: string) {
    return curbs.has(id)
  }

  export function clearWaiting(id: string) {
    holds.delete(id)
  }

  export function waiting(id: string) {
    return holds.has(id)
  }

  /** A goal that is running or suspended on a wait: both block a second run and the question gate. */
  export function hold(id: string) {
    return active(id) || waiting(id)
  }

  export function project(id: string, metadata?: Record<string, unknown> | null) {
    const goal = read(metadata)
    if (!goal) return metadata ?? undefined
    const status = active(id) ? "active" : goal.status === "active" ? "paused" : goal.status
    return { ...metadata, "kilo.goal": { ...goal, status, active: status === "active" } }
  }
}
