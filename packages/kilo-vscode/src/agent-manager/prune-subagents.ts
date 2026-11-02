import type { SessionInfo } from "@opencode/client"
import type { WorktreeStateManager } from "./WorktreeStateManager"

interface PruneSessionSource {
  getSessionInfo?(id: string): Promise<SessionInfo | undefined>
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
    const parent = result.info?.parentID
    if (parent === undefined || parent === null) continue
    state.removeSession(result.item.id)
    sessions.clearSessionDirectory(result.item.id)
    log(`Removed subagent session ${result.item.id} from managed state`)
  }
}
