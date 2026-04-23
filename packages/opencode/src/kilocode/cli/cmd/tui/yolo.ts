// kilocode_change - new file
const sessions = new Set<string>()
const replies = new Map<string, string>()
let startup = false

export namespace TuiYolo {
  export function enabled(sessionID?: string) {
    if (!sessionID) return false
    return sessions.has(sessionID)
  }

  export function set(sessionID: string, enable: boolean) {
    if (enable) {
      sessions.add(sessionID)
      return
    }
    sessions.delete(sessionID)
    replies.delete(sessionID)
  }

  export function boot(sessionID?: string) {
    if (!sessionID) return false
    if (startup) return false
    startup = true
    sessions.add(sessionID)
    return true
  }

  export function shouldReply(sessionID?: string, requestID?: string) {
    if (!sessionID || !requestID) return false
    if (!sessions.has(sessionID)) return false
    return replies.get(sessionID) !== requestID
  }

  export function mark(sessionID: string, requestID: string) {
    replies.set(sessionID, requestID)
  }
}
