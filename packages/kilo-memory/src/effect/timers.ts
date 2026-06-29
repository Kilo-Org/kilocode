type SessionID = string

export namespace MemoryTimers {
  const pending = new Map<SessionID, { root: string; timer: ReturnType<typeof setTimeout> }>()
  const signals = new Map<string, AbortController>()

  export function cancel(sessionID: SessionID) {
    const item = pending.get(sessionID)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(sessionID)
  }

  export function clear(root: string) {
    for (const [sessionID, item] of pending) {
      if (item.root !== root) continue
      clearTimeout(item.timer)
      pending.delete(sessionID)
    }
    signals.get(root)?.abort()
    signals.delete(root)
  }

  export function signal(root: string) {
    const prior = signals.get(root)
    if (prior) return prior.signal
    const ctl = new AbortController()
    signals.set(root, ctl)
    return ctl.signal
  }

  export function done(sessionID: SessionID) {
    pending.delete(sessionID)
  }

  export function set(sessionID: SessionID, root: string, timer: ReturnType<typeof setTimeout>) {
    cancel(sessionID)
    timer.unref?.()
    pending.set(sessionID, { root, timer })
  }
}
