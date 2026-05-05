import type { AgentManagerSessionPrefs, ManagedSessionState } from "../src/types/messages"

interface SessionPrefsTarget {
  setSessionPrefs: (sessionID: string, prefs: AgentManagerSessionPrefs) => void
}

export function restoreSessionPrefs(session: SessionPrefsTarget, items: ManagedSessionState[]) {
  for (const item of items) {
    if (item.prefs) session.setSessionPrefs(item.id, item.prefs)
  }
}
