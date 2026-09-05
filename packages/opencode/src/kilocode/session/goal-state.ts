export namespace GoalState {
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
    return { text: goal.text, active: "active" in goal && goal.active === true }
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
    return { ...metadata, "kilo.goal": { text: goal.text, active: active(id) } }
  }
}
