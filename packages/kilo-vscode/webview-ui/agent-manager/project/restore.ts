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
} from "../../src/types/messages/agent-manager"
import { LOCAL, directoryOwner } from "../navigate"

export interface RestoreDeps {
  selectLocal: () => void
  selectWorktree: (id: string) => void
  focusLocal: (id: string) => void
  focusManaged: (worktreeId: string, sessionId: string) => void
  setSelection: (id: string | null) => void
  setActivePendingId: (id: string | undefined) => void
  /** The directory the server runs a session in, when the catalog already listed it. */
  directoryOf?: (sessionId: string) => string | undefined
  /** The project root, for placing a session directory on Local. */
  rootOf?: () => string | undefined
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
    // A filing from an older build can name a worktree the server does not run the session in. That worktree's
    // view reads the store of its own directory, so restoring into it shows an empty panel. Follow the server
    // directory when the catalog already knows it. `directoryOwner` returns undefined for a directory it cannot
    // place (for example a path alias), and the filing is kept then.
    const directory = deps.directoryOf?.(target.sessionId)
    const owner = directory === undefined ? undefined : directoryOwner(directory, state.worktrees, deps.rootOf?.())
    if (owner !== undefined) {
      if (owner === null) deps.focusLocal(target.sessionId)
      else deps.focusManaged(owner, target.sessionId)
      return
    }
    if (managed?.worktreeId && state.worktrees.some((wt) => wt.id === managed.worktreeId)) {
      deps.focusManaged(managed.worktreeId, managed.id)
      return
    }
    // Local or unmanaged live session: add it to Local and select it directly.
    deps.focusLocal(target.sessionId)
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
