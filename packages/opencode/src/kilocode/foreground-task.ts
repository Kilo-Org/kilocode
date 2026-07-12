// kilocode_change - new file
import type { SessionID } from "@/session/schema"

export namespace ForegroundTask {
  export interface Handle {
    interrupt(): void
  }

  interface Entry {
    token: symbol
    handle: Handle
  }

  const entries = new Map<SessionID, Entry>()

  export function register(sessionID: SessionID, handle: Handle) {
    if (entries.has(sessionID)) {
      throw new Error(`Foreground task already registered for session ${sessionID}`)
    }

    const entry: Entry = {
      token: Symbol(sessionID),
      handle,
    }

    entries.set(sessionID, entry)

    return () => {
      const current = entries.get(sessionID)
      if (current?.token !== entry.token) return
      entries.delete(sessionID)
    }
  }

  export function interrupt(sessionID: SessionID) {
    const entry = entries.get(sessionID)
    if (!entry) return false

    // Delete the exact entry before invoking user code.
    // A resumed task using the same task_id may register a new entry while
    // the previous child Promise is still finishing.
    entries.delete(sessionID)
    entry.handle.interrupt()
    return true
  }

  export function has(sessionID: SessionID) {
    return entries.has(sessionID)
  }
}
