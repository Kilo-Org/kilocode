type SessionID = string

export namespace MemoryTimers {
  const pending = new Map<SessionID, { root: string; timer: ReturnType<typeof setTimeout> }>()
  const signals = new Map<string, { ctl: AbortController; active: number }>()

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
    signals.get(root)?.ctl.abort()
    signals.delete(root)
  }

  // One AbortController per root, shared across concurrent captures and ref-counted so it is dropped
  // once the last in-flight capture for the root settles (see `release`). Without this the map grows
  // for every distinct root a long-lived shared backend ever touches. disable/purge still force-abort
  // via `clear`; `release` tolerates an already-cleared entry.
  export function signal(root: string) {
    const prior = signals.get(root)
    if (prior) {
      prior.active += 1
      return prior.ctl.signal
    }
    const ctl = new AbortController()
    signals.set(root, { ctl, active: 1 })
    return ctl.signal
  }

  export function release(root: string) {
    const item = signals.get(root)
    if (!item) return
    item.active -= 1
    if (item.active <= 0) signals.delete(root)
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
