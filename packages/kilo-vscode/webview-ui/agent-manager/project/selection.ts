import { createEffect } from "solid-js"
import type {
  AgentManagerSidebarTarget,
  ExtensionMessage,
  ManagedSessionState,
} from "../../src/types/messages/agent-manager"
import { LOCAL } from "../navigate"
import { rememberTarget } from "./restore"

export interface ProjectSelectionDeps {
  active: (projectId: string) => boolean
  applied: (projectId: string) => boolean
  managed: (projectId: string) => ManagedSessionState[]
  local: (projectId: string) => void
  worktree: (projectId: string, worktreeId: string) => void
  focusLocal: (sessionId: string) => void
  managedSession: (worktreeId: string, sessionId: string) => void
}

export function canOptimisticTarget(
  target: AgentManagerSidebarTarget,
  worktrees: readonly { id: string }[],
  managed: readonly { id: string }[],
): boolean {
  if (target.kind === "local") return true
  if (target.kind === "worktree") return worktrees.some((wt) => wt.id === target.worktreeId)
  // Only apply session targets optimistically when already filed in `managed`; unfiled
  // live worktree sessions must wait for the host's `fileLiveSession` so they are never
  // misfiled into Local or clobber a pending Local draft.
  return managed.some((s) => s.id === target.sessionId)
}

export function sameSidebarTarget(a: AgentManagerSidebarTarget, b: AgentManagerSidebarTarget): boolean {
  if (a.projectId !== b.projectId || a.kind !== b.kind) return false
  if (a.kind === "worktree" && b.kind === "worktree") return a.worktreeId === b.worktreeId
  if (a.kind === "session" && b.kind === "session") return a.sessionId === b.sessionId
  return true
}

function applyTarget(target: AgentManagerSidebarTarget, deps: ProjectSelectionDeps): void {
  if (target.kind === "local") deps.local(target.projectId)
  if (target.kind === "worktree") deps.worktree(target.projectId, target.worktreeId)
  if (target.kind === "session") {
    const session = deps.managed(target.projectId).find((item) => item.id === target.sessionId)
    if (session?.worktreeId) deps.managedSession(session.worktreeId, target.sessionId)
    else {
      // An unassigned session joins the project's local tabs before it becomes
      // current, replacing any temporary New Session draft.
      deps.focusLocal(target.sessionId)
    }
  }
}

export function applyProjectSelection(msg: ExtensionMessage, deps: ProjectSelectionDeps): boolean {
  if (msg.type !== "agentManager.selectionActivated") return false
  const target = msg.target
  // A selection acknowledgement can arrive after the user switched again.
  // Ignore it unless this project's catalog entry and state are both active.
  if (!deps.active(target.projectId)) return true
  // State application owns the project-scoped stores used by the callbacks.
  // A cold reactivation can acknowledge before that state arrives; waiting for
  // the state transition prevents the previous project's store from handling
  // this target. restoreProjectTarget applies the persisted target afterward.
  if (!deps.applied(target.projectId)) return true
  // Scope by project like the session branch: a selection ack must never act on
  // another project's data if it lands before that project's state push.
  applyTarget(target, deps)
  return true
}

/**
 * Coordinates sidebar selection between the webview and extension host.
 *
 * Same-project selections whose target is already known in the active project
 * apply optimistically in the same click tick so switching never waits on a
 * host IPC round-trip. The host still receives `activateSelection` with a
 * monotonic `seq` to persist `activeTarget` and validate; matching acks are
 * ignored while fallbacks (e.g., deleted worktree -> local) reconcile cleanly.
 */
export function createSelectionController(
  deps: ProjectSelectionDeps & {
    beforeActivate: () => void
    post: (msg: { type: "agentManager.activateSelection"; target: AgentManagerSidebarTarget; restore?: boolean; seq: number }) => void
    canOptimistic: (target: AgentManagerSidebarTarget) => boolean
  },
) {
  let seq = 0
  let optimistic: { seq: number; target: AgentManagerSidebarTarget } | undefined

  const activate = (target: AgentManagerSidebarTarget, restore?: boolean) => {
    deps.beforeActivate()
    const next = ++seq
    const immediate = !restore && deps.active(target.projectId) && deps.applied(target.projectId) && deps.canOptimistic(target)
    optimistic = immediate ? { seq: next, target } : undefined
    // Post before applying so host receives activateSelection ahead of any
    // follow-up effects (rememberTarget, visibleSession, startDiffWatch).
    deps.post({ type: "agentManager.activateSelection", target, restore, seq: next })
    if (immediate) applyTarget(target, deps)
  }

  const receive = (msg: ExtensionMessage): boolean => {
    if (msg.type !== "agentManager.selectionActivated") return false
    if (msg.seq !== undefined && msg.seq < seq) return true
    if (optimistic && msg.seq === optimistic.seq && sameSidebarTarget(optimistic.target, msg.target)) {
      optimistic = undefined
      return true
    }
    optimistic = undefined
    return applyProjectSelection(msg, deps)
  }

  return { activate, receive }
}

/**
 * Persist the current selection for the applied project so switching back
 * restores it. Skips while the catalog and applied project disagree (the
 * switch window), and never persists a selection the project does not own.
 */
export function createTargetRememberer(opts: {
  pid: () => string | undefined
  applied: () => string | undefined
  selection: () => string | null
  owns: (sel: string) => boolean
  sessionId: () => string | undefined
  post: Parameters<typeof rememberTarget>[0]
}): void {
  createEffect(() => {
    const pid = opts.pid()
    if (!pid) return
    // pid flips with the catalog push, before the new project's state is
    // applied. In that window selection() still belongs to the previous
    // project, so persisting it would poison this project's target.
    if (opts.applied() !== pid) return
    const sel = opts.selection()
    if (sel && sel !== LOCAL && !opts.owns(sel)) return
    rememberTarget(opts.post, pid, sel, opts.sessionId())
  })
}
