import type { SessionInfo } from "@opencode/client"
import type { WorktreeStateManager } from "./WorktreeStateManager"

interface PruneSessionSource {
  /** Resolves null when the server reports that the session does not exist, and undefined when it cannot tell. */
  getSessionInfo?(id: string): Promise<SessionInfo | null | undefined>
  clearSessionDirectory(id: string): void
}

export async function pruneSubagents(
  state: WorktreeStateManager,
  sessions: PruneSessionSource | undefined,
  log: (message: string) => void,
): Promise<void> {
  const get = sessions?.getSessionInfo
  if (!sessions || !get) return
  const managed = state.getSessions()
  const infos = await Promise.all(managed.map(async (item) => ({ item, info: await get(item.id) })))
  for (const result of infos) {
    // A session from another profile or a reset database cannot open, so its tab would only show the server error.
    if (result.info === null) {
      state.removeSession(result.item.id)
      sessions.clearSessionDirectory(result.item.id)
      log(`Removed session ${result.item.id} from managed state: the server does not have it`)
      continue
    }
    const parent = result.info?.parentID
    if (parent === undefined || parent === null) continue
    state.removeSession(result.item.id)
    sessions.clearSessionDirectory(result.item.id)
    log(`Removed subagent session ${result.item.id} from managed state`)
  }
}

/** True when the server reports that the session does not exist. */
export function sessionMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as Record<string, unknown>
  return value._tag === "SessionNotFoundError" || value.name === "SessionNotFoundError"
}
