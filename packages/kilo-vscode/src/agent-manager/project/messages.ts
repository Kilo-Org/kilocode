/**
 * Project message handlers for the Agent Manager multi-project protocol.
 *
 * Extracted from AgentManagerProvider (file-size cap) and kept free of VS Code
 * imports so the flows are unit-testable. All handlers fail closed: unknown
 * projects and disabled experiments leave state untouched.
 */

import { GitOps } from "../GitOps"
import type { Host } from "../host"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "../types"
import type { ProjectRegistry } from "./registry"
import type { ProjectContext, ProjectInitResult } from "./context"
import type { ProjectContexts } from "./contexts"
import { canonicalizePath, projectIdFor, resolveProjectRoot, samePath } from "./paths"
import type { SidebarTarget, SessionRef } from "./route"
import { cloneProject, createProject, defaultParent, onboard, type Onboarding } from "./onboarding"
import { runner } from "./prepare"

const pending = new WeakSet<ProjectMessageDeps>()

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
  pickFolder: Host["pickFolder"]
  onboarding: Onboarding["host"]
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
  /** Post an outbound message to the webview. */
  post: (message: AgentManagerOutMessage) => void
  /** Show a user-facing error. */
  error: (message: string) => void
  /** Open the Kilo Settings editor, optionally on a tab and project. */
  openSettings: (tab?: string, projectId?: string) => void
  /** Ensure a context's repository state is ready (no-op once initialized). */
  ready: (ctx: ProjectContext, options?: { warm?: boolean }) => Promise<ProjectInitResult>
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
  if (m.type === "agentManager.cloneProject") {
    await cloneNewProject(m.url, m.parent, deps)
    return true
  }
  if (m.type === "agentManager.createProject") {
    await createNewProject(m.parent, m.name, deps)
    return true
  }
  if (m.type === "agentManager.requestProjectParent") {
    await postParent(deps)
    return true
  }
  if (m.type === "agentManager.pickProjectParent") {
    const picked = await deps.pickFolder({
      defaultPath: m.defaultPath || undefined,
      title: "Choose the parent folder for the project",
    })
    deps.post({ type: "agentManager.projectParent", parent: picked })
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

function onboardingDeps(deps: ProjectMessageDeps, git: GitOps): Onboarding {
  return {
    host: deps.onboarding,
    pickFolder: deps.pickFolder,
    primary: deps.contexts.pinned()?.root,
    git,
    enabled: deps.enabled,
    registered: (dir) => Boolean(deps.registry.get(projectIdFor(canonicalizePath(dir)))),
  }
}

async function addProject(deps: ProjectMessageDeps): Promise<void> {
  await attachPrepared((git) => onboard(onboardingDeps(deps, git)), deps)
}

async function cloneNewProject(url: string, parent: string, deps: ProjectMessageDeps): Promise<void> {
  await attachPrepared((git) => cloneProject(url, parent, onboardingDeps(deps, git)), deps)
}

async function createNewProject(parent: string, name: string, deps: ProjectMessageDeps): Promise<void> {
  await attachPrepared((git) => createProject(parent, name, onboardingDeps(deps, git)), deps)
}

/** Post the canonical parent folder for a new project: the primary checkout's parent. */
async function postParent(deps: ProjectMessageDeps): Promise<void> {
  if (disabled(deps)) return
  const git = deps.git ?? new GitOps({ log: deps.log })
  try {
    deps.post({
      type: "agentManager.projectParent",
      parent: await defaultParent(deps.contexts.pinned()?.root, git),
    })
  } catch (err) {
    deps.log("defaultProjectParent failed:", err)
    deps.post({ type: "agentManager.projectParent" })
  } finally {
    if (!deps.git) git.dispose()
  }
}

/** Prepare a root through a native flow, then register and select it. */
async function attachPrepared(
  prepare: (git: GitOps) => Promise<string | undefined>,
  deps: ProjectMessageDeps,
): Promise<void> {
  if (disabled(deps) || pending.has(deps)) return
  pending.add(deps)
  const git = deps.git ?? new GitOps({ log: deps.log })
  let root: string | undefined
  try {
    root = await prepare(git)
    if (root) await attach(root, deps, git)
  } catch (err) {
    deps.log("addProject failed:", err)
    const message = err instanceof Error ? err.message : "Failed to add the project."
    deps.error(
      root
        ? `Could not add the project at ${root}. The repository has been kept; use Open local folder to retry. ${message}`
        : message,
    )
  } finally {
    pending.delete(deps)
    if (!deps.git) git.dispose()
  }
}

/** Register a prepared root, then select it without warming a worktree of its own. */
async function attach(root: string, deps: ProjectMessageDeps, git: GitOps): Promise<void> {
  if (!deps.enabled())
    throw new Error(
      "Multi-project Agent Manager was disabled. Enable it and use Open local folder to attach this project.",
    )
  const pinned = deps.contexts.pinned()
  const primary = pinned && (await resolveProjectRoot(pinned.root, runner(git)))
  const id = pinned && samePath(primary ?? pinned.root, root) ? pinned.id : projectIdFor(root)
  const existing = id === pinned?.id || Boolean(deps.registry.get(id))
  if (!existing) await deps.registry.add({ id, root })
  await deps.registry.setExpanded(id, true)
  const ctx = deps.contexts.expand(id)
  if (!ctx) throw new Error("The project is unavailable.")
  const result = await deps.ready(ctx, { warm: false })
  deps.push()
  if (!result.current || !result.ok || !deps.enabled()) throw new Error("Expand the project to retry initialization.")
  finish({ projectId: id, kind: "local" }, deps)
  if (existing) deps.onboarding.notify("info", `Opened the existing project at ${root}.`)
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
