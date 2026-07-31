/**
 * Seamless project-switch restore for the multi-project Agent Manager.
 *
 * The extension persists the last selected sidebar target per project
 * (`agentManager.state.activeTarget`). When a state payload arrives for a
 * project the webview was not showing (project switch or initial open), this
 * module puts the user back exactly where they left off instead of resetting
 * to Local with a fresh "New Session" draft.
 */

import type {
  AgentManagerStateMessage,
  AgentManagerSidebarTarget,
  RememberTargetMessage,
} from "../../src/types/messages"
import { LOCAL } from "../navigate"

export interface RestoreDeps {
  selectLocal: () => void
  selectWorktree: (id: string) => void
  selectSession: (id: string) => void
  focusManaged: (worktreeId: string, sessionId: string) => void
  setSelection: (id: string | null) => void
  setActivePendingId: (id: string | undefined) => void
}

/** Restore `state.activeTarget` for the incoming project's state payload. */
export function restoreProjectTarget(state: AgentManagerStateMessage, deps: RestoreDeps): void {
  const target = state.activeTarget
  if (!target || target.projectId !== state.projectId) return deps.selectLocal()
  if (target.kind === "worktree" && state.worktrees.some((wt) => wt.id === target.worktreeId)) {
    deps.setActivePendingId(undefined)
    deps.selectWorktree(target.worktreeId)
    return
  }
  if (target.kind === "session") {
    const managed = state.sessions.find((s) => s.id === target.sessionId)
    deps.setActivePendingId(undefined)
    if (managed?.worktreeId && state.worktrees.some((wt) => wt.id === managed.worktreeId)) {
      deps.focusManaged(managed.worktreeId, managed.id)
      return
    }
    // Local or unmanaged live session: go to Local and select it directly.
    deps.setSelection(LOCAL)
    deps.selectSession(target.sessionId)
    return
  }
  deps.selectLocal()
}

/** Post the current selection to the extension for per-project persistence. */
export function rememberTarget(
  post: (msg: RememberTargetMessage) => void,
  projectId: string,
  selection: string | null,
  sessionId: string | undefined,
): void {
  const target: AgentManagerSidebarTarget = sessionId
    ? { projectId, kind: "session", sessionId }
    : selection && selection !== LOCAL
      ? { projectId, kind: "worktree", worktreeId: selection }
      : { projectId, kind: "local" }
  post({ type: "agentManager.rememberTarget", projectId, target })
}
