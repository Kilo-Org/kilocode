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
  // via `clear`; `release` ignores a signal whose entry was already cleared.
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

  /** Release the signal a capture acquired; a signal that `clear` already dropped leaves a newer entry alone. */
  export function release(root: string, signal: AbortSignal) {
    const item = signals.get(root)
    if (!item || item.ctl.signal !== signal) return
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
