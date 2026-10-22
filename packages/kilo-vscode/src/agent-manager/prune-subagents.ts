import type { SessionProvider } from "./host"
import type { WorktreeStateManager } from "./WorktreeStateManager"

export async function pruneSubagents(
  state: WorktreeStateManager,
  sessions: SessionProvider | undefined,
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
