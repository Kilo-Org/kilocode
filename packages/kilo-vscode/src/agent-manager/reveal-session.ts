import type { ProjectContext } from "./project/context"
import type { ProjectContexts } from "./project/contexts"
import { samePath } from "./project/paths"

export interface ManagedSessionTarget {
  context: ProjectContext
  projectId: string
  sessionId: string
  /** Absent for a session in the project's Local tabs. */
  worktreeId?: string
}

interface RevealMessage {
  type: "agentManager.revealSession"
  projectId: string
  sessionId: string
  worktreeId?: string
}

/**
 * Resolve a session Agent Manager owns, or undefined when the sidebar should
 * handle it. Worktree ownership requires the worktree to still exist and still
 * match the session's directory, so a removed worktree falls back.
 */
export function resolveManagedSession(
  contexts: ProjectContexts,
  directories: ReadonlyMap<string, string>,
  sessionId: string,
): ManagedSessionTarget | undefined {
  const directory = directories.get(sessionId)
  if (!directory) return
  const context = contexts.byDirectory(directory) ?? contexts.byLiveSession(sessionId)
  if (!context) return
  const state = context.peekState()
  const session = state?.getSession(sessionId)
  // A Local tab has no worktree. The panel also tracks plain sidebar sessions
  // discovered in the project root, so only a session Agent Manager persisted
  // counts as owned; anything else keeps the sidebar.
  if (session && !session.worktreeId) {
    if (!samePath(context.root, directory)) return
    return { context, projectId: context.id, sessionId }
  }
  const worktree = session?.worktreeId
    ? state?.getWorktree(session.worktreeId)
    : state?.getWorktrees().find((item) => samePath(item.path, directory))
  if (!worktree || !samePath(worktree.path, directory)) return
  return { context, projectId: context.id, sessionId, worktreeId: worktree.id }
}

export interface RevealDeps {
  /** Session→directory map for sessions Agent Manager currently tracks. */
  directories: () => ReadonlyMap<string, string>
  /** Re-wire provider state for the newly activated project. */
  activate: (context: ProjectContext) => void
  /** Publish the project catalog so the webview applies the new active project. */
  projects: () => void
  open: () => void
  /** Resolve once the project's worktree state is loaded. */
  state: () => Promise<void>
  /** Resolve false when the panel closed before it was ready. */
  ready: () => Promise<boolean>
  post: (message: RevealMessage) => void
}

/**
 * Focus an Agent Manager-owned session. The project is activated and published
 * before the reveal is posted, so the webview never rejects the message as
 * belonging to its previous project.
 */
export async function revealManagedSession(
  sessionId: string,
  contexts: ProjectContexts,
  deps: RevealDeps,
): Promise<boolean> {
  const target = resolveManagedSession(contexts, deps.directories(), sessionId)
  if (!target) return false
  // Re-activating the project the panel already shows would reset its PR,
  // stats, and busy-session state for no gain, so only switch when needed.
  if (contexts.active()?.id !== target.projectId) {
    contexts.activate(target.projectId)
    deps.activate(target.context)
    deps.projects()
  }
  deps.open()
  await deps.state()
  if (!(await deps.ready())) return false
  deps.post({
    type: "agentManager.revealSession",
    projectId: target.projectId,
    sessionId,
    worktreeId: target.worktreeId,
  })
  return true
}
