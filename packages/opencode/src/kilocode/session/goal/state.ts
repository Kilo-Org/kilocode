export namespace GoalState {
  export type Status = "active" | "complete" | "blocked" | "paused"
  type Token = { cancel?: () => void }
  const runs = new Map<string, Token>()
  const pending = new Map<string, Token>()

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
      (goal.status === "active" || goal.status === "complete" || goal.status === "blocked" || goal.status === "paused")
        ? goal.status
        : "active" in goal && goal.active === true
          ? "active"
          : "paused"
    const reason = "reason" in goal && typeof goal.reason === "string" ? goal.reason : undefined
    return { text: goal.text, status, active: status === "active", ...(reason ? { reason } : {}) }
  }

  export function start(id: string, cancel?: () => void) {
    const previous = runs.get(id)
    const token = { cancel }
    runs.set(id, token)
    previous?.cancel?.()
    return () => runs.get(id) === token
  }

  export function pause(id: string, preserve = false) {
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

  export function project(id: string, metadata?: Record<string, unknown> | null) {
    const goal = read(metadata)
    if (!goal) return metadata ?? undefined
    const status = active(id) ? "active" : goal.status === "active" ? "paused" : goal.status
    return { ...metadata, "kilo.goal": { ...goal, status, active: status === "active" } }
  }
}
