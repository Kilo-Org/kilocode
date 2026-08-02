import type { RunStatus } from "../../src/types/messages/agent-manager"
import type { ProjectStore } from "./store"

/**
 * Route a run status emission to the store of its owning project. The
 * extension stamps projectId on every emission in multi-project mode; without
 * a stamp the status belongs to the active project (legacy behavior).
 */
export function applyRunStatus(
  msg: { type: string },
  deps: { ensure: (projectId: string) => ProjectStore; active: () => ProjectStore },
): boolean {
  if (msg.type !== "agentManager.runStatus") return false
  const ev = msg as unknown as RunStatus & { projectId?: string }
  const store = ev.projectId ? deps.ensure(ev.projectId) : deps.active()
  store.setRunStatuses((prev) => ({ ...prev, [ev.worktreeId]: ev }))
  return true
}
