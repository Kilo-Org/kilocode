/**
 * Project message handlers for the Agent Manager multi-project protocol.
 *
 * Extracted from AgentManagerProvider (file-size cap) and kept free of VS Code
 * imports so the flows are unit-testable. All handlers fail closed: unknown
 * projects and disabled experiments leave state untouched.
 */

import simpleGit from "simple-git"
import type { GitOps } from "../GitOps"
import type { AgentManagerInMessage } from "../types"
import type { ProjectRegistry } from "./registry"
import type { ProjectContext, ProjectInitResult } from "./context"
import type { ProjectContexts } from "./contexts"
import { projectIdFor, resolveProjectRoot, samePath } from "./paths"
import type { SidebarTarget, SessionRef } from "./route"

/** Route one session to a directory inside a project via the shared session provider. */
export function routeProjectSession(
  sessions:
    | {
        setSessionDirectory(id: string, directory: string): void
        registerSessionRoute?(ref: SessionRef, directory: string, generation: number): void
      }
    | undefined,
  projectId: string,
  sessionId: string,
  directory: string,
  generation: number,
): void {
  if (!sessions) return
  sessions.setSessionDirectory(sessionId, directory)
  sessions.registerSessionRoute?.({ projectId, sessionId }, directory, generation)
}

export interface ProjectMessageDeps {
  registry: ProjectRegistry
  contexts: ProjectContexts
  /** Whether the multi-project experiment is enabled. */
  enabled: () => boolean
  /** Show a folder picker; resolves undefined when cancelled. */
  pickFolder: () => Promise<string | undefined>
  /** Re-initialize provider state for a freshly activated context. */
  activate: (ctx: ProjectContext) => void
  /** Initialize an expanded background context and push its state. */
  expand: (ctx: ProjectContext) => void
  /** Push the current project snapshots to the webview. */
  push: () => void
  /** Push one project's managed state to the webview. */
  pushState?: (ctx: ProjectContext) => void
  /** Acknowledge an atomically validated sidebar selection. */
  selected: (target: SidebarTarget) => void
  /** Show a user-facing error. */
  error: (message: string) => void
  /** Open the Kilo Settings editor, optionally on a tab and project. */
  openSettings: (tab?: string, projectId?: string) => void
  /** Ensure a context's repository state is ready (no-op once initialized). */
  ready: (ctx: ProjectContext) => Promise<ProjectInitResult>
  /** Route one session to a directory inside a project (session override + project route). */
  routeSession?: (projectId: string, sessionId: string, directory: string, generation: number) => void
  git?: GitOps
  log: (...args: unknown[]) => void
}

/** Handle a project-management message. Returns true when the message was consumed. */
export async function handleProjectMessage(m: AgentManagerInMessage, deps: ProjectMessageDeps): Promise<boolean> {
  if (m.type === "openSettingsPanel") {
    deps.openSettings(m.tab, m.projectId)
    return true
  }
  if (m.type === "agentManager.requestProjects") {
    deps.push()
    return true
  }
  if (m.type === "agentManager.addProject") {
    await addProject(deps)
    return true
  }
  if (m.type === "agentManager.removeProject") {
    await removeProject(m.projectId, deps)
    return true
  }
  if (m.type === "agentManager.selectProject") {
    selectProject(m.projectId, deps)
    return true
  }
  if (m.type === "agentManager.activateSelection") {
    await activateSelection(m.target, deps, m.restore === true)
    return true
  }
  if (m.type === "agentManager.openSessionLocally") {
    if (!m.projectId) return false
    await openSessionLocally(m.projectId, m.sessionId, deps)
    return true
  }
  if (m.type === "agentManager.rememberTarget") {
    rememberTarget(m.projectId, m.target, deps)
    return true
  }
  if (m.type === "agentManager.setProjectExpanded") {
    await setExpanded(m.projectId, m.expanded, deps)
    return true
  }
  return false
}

async function activateSelection(requested: SidebarTarget, deps: ProjectMessageDeps, restore = false): Promise<void> {
  if (disabled(deps)) return
  const ctx = deps.contexts.resolve(requested.projectId)
  if (!ctx || !deps.contexts.usable(requested.projectId)) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  const result = await deps.ready(ctx)
  if (!result.current || !result.ok) {
    deps.error("The project is not ready yet. Expand it before selecting a worktree or session.")
    deps.push()
    return
  }
  const state = ctx.peekState()
  // Restoring a project returns the user to their persisted target for it.
  const persisted = restore ? state?.getActiveTarget() : undefined
  const target = persisted?.projectId === requested.projectId ? persisted : requested
  // A missing target is not actionable: the user clicked a sidebar row the
  // extension itself offered, or the persisted restore target went stale.
  // Fall back to the project's local context instead of an error toast.
  if (target.kind === "worktree" && !state?.getWorktree(target.worktreeId)) {
    deps.log(`selection target worktree ${target.worktreeId} is gone, falling back to local`)
    return finish({ projectId: target.projectId, kind: "local" }, deps)
  }
  if (target.kind === "session" && !state?.getSession(target.sessionId) && !ctx.hasLiveSession(target.sessionId)) {
    deps.log(`selection target session ${target.sessionId} is gone, falling back to local`)
    return finish({ projectId: target.projectId, kind: "local" }, deps)
  }
  finish(target, deps)
}

/**
 * Move a worktree-bound session back to the project root and open it in the
 * project's local tabs. Fall back to local gracefully when the worktree is
 * already gone (the session may be live only).
 */
async function openSessionLocally(projectId: string, sessionId: string, deps: ProjectMessageDeps): Promise<void> {
  if (disabled(deps)) return
  const ctx = deps.contexts.resolve(projectId)
  if (!ctx || !deps.contexts.usable(projectId)) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  const result = await deps.ready(ctx)
  if (!result.current || !result.ok) {
    deps.error("The project is not ready yet. Expand it before selecting a worktree or session.")
    deps.push()
    return
  }
  const state = ctx.peekState()
  if (!state?.getSession(sessionId) && !ctx.hasLiveSession(sessionId)) {
    deps.log(`openSessionLocally: unknown session ${sessionId}`)
    return
  }
  state?.moveSession(sessionId, null)
  deps.routeSession?.(projectId, sessionId, ctx.root, ctx.generation)
  deps.pushState?.(ctx)
  deps.push()
  finish({ projectId, kind: "session", sessionId }, deps)
}

/** Commit the active project, persist the target, and acknowledge the selection. */
function finish(target: SidebarTarget, deps: ProjectMessageDeps): void {
  const previous = deps.contexts.active()?.id
  const activated = deps.contexts.activate(target.projectId)
  if (!activated) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  activated.peekState()?.setActiveTarget(target)
  if (previous !== activated.id) deps.activate(activated)
  deps.push()
  deps.selected(target)
}

/** Persist the webview's current selection without activating or validating anything. */
function rememberTarget(projectId: string, target: SidebarTarget, deps: ProjectMessageDeps): void {
  if (target.projectId !== projectId) return
  const state = deps.contexts.get(projectId)?.peekState()
  if (!state) return
  // Never persist a target the project does not have: the webview can race a
  // project switch and still hold the previous project's selection.
  if (target.kind === "worktree" && !state.getWorktree(target.worktreeId)) return
  if (
    target.kind === "session" &&
    !state.getSession(target.sessionId) &&
    !deps.contexts.get(projectId)?.hasLiveSession(target.sessionId)
  )
    return
  state.setActiveTarget(target)
}

function disabled(deps: ProjectMessageDeps): boolean {
  if (deps.enabled()) return false
  deps.error("Multi-project Agent Manager is disabled. Enable it in Kilo Settings > Experimental to add projects.")
  return true
}

async function addProject(deps: ProjectMessageDeps): Promise<void> {
  if (disabled(deps)) return
  const dir = await deps.pickFolder()
  if (!dir) return
  // resolveProjectRoot (not resolveGitRoot) so a folder inside a linked worktree
  // registers the primary checkout and cannot duplicate an existing project.
  const git = deps.git
  const root = await resolveProjectRoot(
    dir,
    git
      ? async (cwd, args) => {
          const result = await git.execGit(args, cwd)
          if (result.code !== 0) throw new Error(result.stderr)
          return result.stdout
        }
      : (cwd, args) => simpleGit(cwd).raw(args),
  )
  if (!root) {
    deps.error("The selected folder is not inside a Git repository.")
    return
  }
  const pinned = deps.contexts.pinned()
  if (pinned && samePath(pinned.root, root)) {
    deps.error("That repository is already the workspace project.")
    return
  }
  const id = projectIdFor(root)
  if (deps.registry.get(id)) {
    deps.error("That repository is already registered as a project.")
    return
  }
  try {
    await deps.registry.add({ id, root })
  } catch (err) {
    deps.log("addProject: registry write failed:", err)
    deps.error("Failed to save the project. See the Agent Manager output for details.")
    return
  }
  deps.log(`addProject: registered ${root}`)
  deps.push()
}

async function removeProject(id: string, deps: ProjectMessageDeps): Promise<void> {
  if (disabled(deps)) return
  await deps.contexts.remove(id)
  await deps.registry.remove(id)
  deps.push()
}

function selectProject(id: string, deps: ProjectMessageDeps): void {
  if (disabled(deps)) return
  const ctx = deps.contexts.activate(id)
  if (!ctx) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    deps.push()
    return
  }
  deps.activate(ctx)
  deps.push()
}

async function setExpanded(id: string, expanded: boolean, deps: ProjectMessageDeps): Promise<void> {
  if (disabled(deps)) return
  const ctx = expanded ? deps.contexts.usable(id) : deps.contexts.resolve(id)
  if (!ctx) {
    deps.push()
    return
  }
  await deps.registry.setExpanded(id, expanded)
  if (expanded) {
    const next = deps.contexts.expand(id)
    if (next) deps.expand(next)
  }
  if (!expanded) deps.contexts.collapse(id)
  deps.push()
}
