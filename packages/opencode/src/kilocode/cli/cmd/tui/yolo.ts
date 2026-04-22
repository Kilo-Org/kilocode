// kilocode_change - new file
const sessions = new Set<string>()
const seen = new Set<string>()
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
  }

  export function consume() {
    if (startup) return false
    startup = true
    return true
  }

  export function shouldReply(sessionID?: string, requestID?: string) {
    if (!sessionID || !requestID) return false
    if (!sessions.has(sessionID)) return false
    if (seen.has(requestID)) return false
    return true
  }

  export function mark(requestID: string) {
    seen.add(requestID)
  }
}
