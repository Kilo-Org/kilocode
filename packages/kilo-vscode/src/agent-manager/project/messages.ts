/**
 * Project message handlers for the Agent Manager multi-project protocol.
 *
 * Extracted from AgentManagerProvider (file-size cap) and kept free of VS Code
 * imports so the flows are unit-testable. All handlers fail closed: unknown
 * projects leave state untouched.
 */

import { GitOps } from "../GitOps"
import type { Host } from "../host"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "../types"
import type { ProjectRegistry } from "./registry"
import type { ProjectContext, ProjectInitResult } from "./context"
import type { ProjectContexts } from "./contexts"
import { canonicalizePath, pathKey, projectIdFor, resolveProjectRoot, samePath } from "./paths"
import type { SidebarTarget, SessionRef } from "./route"
import { cloneProject, createProject, defaultParent, onboard, type Onboarding } from "./onboarding"
import { runner } from "./prepare"
import type { RouteOutcome } from "../route-session"

const pending = new WeakSet<ProjectMessageDeps>()
const selections = new WeakMap<ProjectMessageDeps, symbol>()

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
  /** Show a folder picker; resolves undefined when cancelled. */
  pickFolder: Host["pickFolder"]
  onboarding: Onboarding["host"]
  /** Re-initialize provider state for a freshly activated context. */
  activate: (ctx: ProjectContext) => void
  /** Clear the applied project when the last project is removed. */
  empty?: () => void
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
  /** Report a non-failing result, such as a move that waits for the current step. */
  notify?: (kind: "info" | "warning" | "error", message: string) => void
  /** Open the Kilo Settings editor, optionally on a tab and project. */
  openSettings: (tab?: string, projectId?: string) => void
  /** Ensure a context's repository state is ready (no-op once initialized). */
  ready: (ctx: ProjectContext, options?: { warm?: boolean }) => Promise<ProjectInitResult>
  /**
   * Route one session to a directory inside a project. A move the server applies at a later step boundary reports
   * `queued`; the filing follows the `session.moved` event when it lands.
   */
  routeSession?: (
    projectId: string,
    sessionId: string,
    directory: string,
    generation: number,
  ) => Promise<RouteOutcome>
  /** The directory the server runs a session in, for a session another surface names without a project. */
  sessionDirectory?: (sessionId: string) => Promise<string | undefined>
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
  if (m.type === "agentManager.openSession") {
    await openSession(m.projectId, m.sessionId, deps)
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
  if (m.type === "agentManager.setProjectOrder") {
    // Always push, so a failed write replaces the webview's optimistic order with the stored one.
    if (Array.isArray(m.order))
      await deps.registry
        .reorder(m.order.filter((id) => typeof id === "string"))
        .catch((err) => deps.log("Failed to save project order:", err))
    deps.push()
    return true
  }
  return false
}

async function activateSelection(requested: SidebarTarget, deps: ProjectMessageDeps, restore = false): Promise<void> {
  const ctx = deps.contexts.resolve(requested.projectId)
  if (!ctx) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  // Record the token only for an actionable target, so a click on an
  // unavailable project cannot discard a pending valid selection.
  const token = Symbol()
  selections.set(deps, token)
  const result = await deps.ready(ctx, { warm: true })
  // A newer click can finish while this project's readiness is pending.
  if (selections.get(deps) !== token) return
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
  if (target.kind === "session" && !state?.getSession(target.sessionId)) {
    if (!ctx.hasLiveSession(target.sessionId) || !fileLiveSession(ctx, target.sessionId)) {
      deps.log(`selection target session ${target.sessionId} is gone, falling back to local`)
      return finish({ projectId: target.projectId, kind: "local" }, deps)
    }
    deps.pushState?.(ctx)
  }
  finish(target, deps)
}

/**
 * File a live session under the directory it runs in before it is selected. Closing a tab removes its filing, and
 * only the store of the server directory receives its events, so the session must not open through another view.
 * Returns false when the directory is outside the project.
 */
function fileLiveSession(ctx: ProjectContext, sessionId: string): boolean {
  const directory = ctx.sessions().find((item) => item.id === sessionId)?.location.directory
  return directory !== undefined && fileSessionByDirectory(ctx, sessionId, directory) !== undefined
}

/**
 * File a session under the worktree that owns its server directory, or under Local when it runs in the project
 * root. A view reads the store of that directory, so a session filed anywhere else never receives its events.
 * Returns the worktree id, `null` for Local, or undefined when the directory is outside the project.
 */
function fileSessionByDirectory(
  ctx: ProjectContext,
  sessionId: string,
  directory: string,
): string | null | undefined {
  const state = ctx.peekState()
  if (!state) return undefined
  const owner = pathKey(directory) === pathKey(ctx.root) ? null : (state.findWorktreeByPath(directory)?.id ?? undefined)
  if (owner === undefined) return undefined
  const filed = state.getSession(sessionId)
  if (!filed) state.addSession(sessionId, owner)
  else if (filed.worktreeId !== owner) state.moveSession(sessionId, owner)
  return owner
}

/**
 * Open a session a chat link or another surface names, in the context of the directory the server runs it in. The
 * link carries no project, so resolve it from the server directory first and fall back to the live catalog.
 */
async function openSession(projectId: string | undefined, sessionId: string, deps: ProjectMessageDeps): Promise<void> {
  // A link can resolve after the user clicked a sidebar row or another link. The newer selection owns the view.
  const token = Symbol()
  selections.set(deps, token)
  const directory = await deps.sessionDirectory?.(sessionId)
  if (selections.get(deps) !== token) return
  const ctx =
    (projectId ? deps.contexts.resolve(projectId) : undefined) ??
    (directory ? deps.contexts.byDirectory(directory) : undefined) ??
    deps.contexts.byLiveSession(sessionId) ??
    deps.contexts.active()
  if (!ctx) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  const result = await deps.ready(ctx, { warm: true })
  if (selections.get(deps) !== token) return
  if (!result.current || !result.ok) {
    deps.error("The project is not ready yet. Expand it before selecting a worktree or session.")
    deps.push()
    return
  }
  const resolved = directory ?? ctx.sessions().find((item) => item.id === sessionId)?.location.directory
  const state = ctx.peekState()
  if (resolved) {
    if (fileSessionByDirectory(ctx, sessionId, resolved) === undefined) {
      deps.log(`openSession: session ${sessionId} runs in ${resolved}, outside the project`)
      return
    }
    deps.pushState?.(ctx)
  } else if (!state?.getSession(sessionId)) {
    deps.log(`openSession: could not locate session ${sessionId}`)
    return
  }
  finish({ projectId: ctx.id, kind: "session", sessionId }, deps)
}

/**
 * Move a worktree-bound session back to the project root and open it in the
 * project's local tabs. Fall back to local gracefully when the worktree is
 * already gone (the session may be live only).
 */
async function openSessionLocally(projectId: string, sessionId: string, deps: ProjectMessageDeps): Promise<void> {
  const ctx = deps.contexts.resolve(projectId)
  if (!ctx) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    return
  }
  const result = await deps.ready(ctx, { warm: true })
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
  // Local reads the store of the project root, so the session must run there before it is filed there. A move the
  // server queued behind a running step is not a failure: the `session.moved` event files it under Local when the
  // server applies it. A failed move keeps the filing, and the error says why.
  const outcome = deps.routeSession
    ? await deps.routeSession(projectId, sessionId, ctx.root, ctx.generation)
    : "moved"
  if (outcome === "failed") {
    deps.error("Could not move the conversation to Local. It still runs in its worktree.")
    deps.pushState?.(ctx)
    return
  }
  if (outcome === "queued") {
    deps.notify?.("info", "The conversation will move to Local when its current step finishes.")
    // The session still runs in its worktree; open Local so it appears here when the move lands.
    deps.pushState?.(ctx)
    finish({ projectId, kind: "local" }, deps)
    return
  }
  state?.moveSession(sessionId, null)
  deps.pushState?.(ctx)
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
    (state.isSessionClosed(target.sessionId) ||
      (!state.getSession(target.sessionId) && !deps.contexts.get(projectId)?.hasLiveSession(target.sessionId)))
  )
    return
  state.setActiveTarget(target)
}

function onboardingDeps(deps: ProjectMessageDeps, git: GitOps): Onboarding {
  return {
    host: deps.onboarding,
    pickFolder: deps.pickFolder,
    primary: deps.contexts.pinned()?.root,
    git,
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
  if (pending.has(deps)) return
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
  root = canonicalizePath(root)
  const pinned = deps.contexts.pinned()
  const primary = pinned && (await resolveProjectRoot(pinned.root, runner(git)))
  const id = pinned && samePath(primary ?? pinned.root, root) ? pinned.id : projectIdFor(root)
  const existing = id === pinned?.id || deps.registry.has(id)
  if (!existing) await deps.registry.add({ id, root })
  await deps.registry.setExpanded(id, true)
  const ctx = deps.contexts.expand(id)
  if (!ctx) throw new Error("The project is unavailable.")
  const result = await deps.ready(ctx, { warm: false })
  deps.push()
  if (!result.current || !result.ok) throw new Error("Expand the project to retry initialization.")
  finish({ projectId: id, kind: "local" }, deps)
  if (existing) deps.onboarding.notify("info", `Opened the existing project at ${root}.`)
}

async function removeProject(id: string, deps: ProjectMessageDeps): Promise<void> {
  if (deps.contexts.pinned()?.id === id) return
  const active = deps.contexts.active()?.id === id
  await deps.registry.remove(id)
  await deps.contexts.remove(id)
  deps.push()
  if (!active) return
  const next = deps.contexts.active()
  if (next) deps.activate(next)
  else deps.empty?.()
}

function selectProject(id: string, deps: ProjectMessageDeps): void {
  const ctx = deps.contexts.activate(id)
  if (!ctx) {
    deps.error("The project is unavailable. Check that the repository still exists.")
    deps.push()
    return
  }
  deps.activate(ctx)
  ctx.warmPool()
  deps.push()
}

async function setExpanded(id: string, expanded: boolean, deps: ProjectMessageDeps): Promise<void> {
  const ctx = deps.contexts.resolve(id)
  if (!ctx) {
    deps.push()
    return
  }
  await deps.registry.setExpanded(id, expanded)
  if (expanded) {
    const next = deps.contexts.expand(id)
    if (next) {
      await deps.ready(next, { warm: true }).catch((err) => deps.log("Failed to initialize expanded project:", err))
      deps.expand(next)
    }
  }
  if (!expanded) deps.contexts.collapse(id)
  deps.push()
}
