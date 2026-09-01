export namespace GoalState {
  const runs = new Map<string, object>()
  const pending = new Map<string, object>()

  export function prepare(id: string) {
    const token = {}
    pending.set(id, token)
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
    return { text: goal.text, active: "active" in goal && goal.active === true }
  }

  export function start(id: string) {
    const token = {}
    runs.set(id, token)
    return () => runs.get(id) === token
  }

  export function pause(id: string, preserve = false) {
    if (!preserve) pending.delete(id)
    return runs.delete(id)
  }

  export function active(id: string) {
    return runs.has(id)
  }

  export function project(id: string, metadata?: Record<string, unknown> | null) {
    const goal = read(metadata)
    if (!goal) return metadata ?? undefined
    return { ...metadata, "kilo.goal": { text: goal.text, active: active(id) } }
  }
}
