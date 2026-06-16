// kilocode_change - new file
const sessions = new Set<string>()
const replies = new Map<string, Set<string>>()

export namespace TuiAutoApprove {
  export function enabled(sessionID?: string) {
    if (!sessionID) return false
    return sessions.has(sessionID)
  }

  export function set(sessionID: string, enable: boolean) {
    if (enable) {
      sessions.add(sessionID)
      return
    }
    clear(sessionID)
  }

  export function boot(sessionID?: string) {
    if (!sessionID) return false
    sessions.add(sessionID)
    return true
  }

  export function shouldReply(sessionID?: string, requestID?: string) {
    if (!sessionID || !requestID) return false
    if (!sessions.has(sessionID)) return false
    return !replies.get(sessionID)?.has(requestID)
  }

  export function mark(sessionID: string, requestID: string) {
    if (!sessions.has(sessionID)) return false
    const seen = replies.get(sessionID) ?? new Set<string>()
    if (seen.has(requestID)) return false
    seen.add(requestID)
    replies.set(sessionID, seen)
    return true
  }

  export function clear(sessionID: string) {
    sessions.delete(sessionID)
    replies.delete(sessionID)
  }

  export function prune(active: Set<string>) {
    for (const sessionID of sessions) {
      if (active.has(sessionID)) continue
      clear(sessionID)
    }
  }
}
