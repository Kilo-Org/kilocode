import type { ProjectContext } from "./project/context"
import type { ProjectContexts } from "./project/contexts"
import { samePath } from "./project/paths"

export interface ManagedSessionTarget {
  context: ProjectContext
  projectId: string
  sessionId: string
  worktreeId: string
}

interface RevealMessage {
  type: "agentManager.revealSession"
  projectId: string
  sessionId: string
  worktreeId: string
}

/** Resolve a live Agent Manager session only while its owning worktree remains present. */
export function resolveManagedSession(
  contexts: ProjectContexts,
  directories: ReadonlyMap<string, string>,
  sessionId: string,
): ManagedSessionTarget | undefined {
  const directory = directories.get(sessionId)
  if (!directory) return
  const context = contexts.byDirectory(directory) ?? contexts.byLiveSession(sessionId)
  const state = context?.peekState()
  const session = state?.getSession(sessionId)
  const worktree = session?.worktreeId
    ? state?.getWorktree(session.worktreeId)
    : state?.getWorktrees().find((item) => samePath(item.path, directory))
  if (!context || !worktree || !samePath(worktree.path, directory)) return
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
  contexts.activate(target.projectId)
  deps.activate(target.context)
  deps.projects()
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
