import { createEffect } from "solid-js"
import type { ExtensionMessage, ManagedSessionState } from "../../src/types/messages"
import { LOCAL } from "../navigate"
import { rememberTarget } from "./restore"

export function applyProjectSelection(
  msg: ExtensionMessage,
  deps: {
    active: (projectId: string) => boolean
    applied: (projectId: string) => boolean
    managed: (projectId: string) => ManagedSessionState[]
    local: (projectId: string) => void
    worktree: (projectId: string, worktreeId: string) => void
    focusLocal: (sessionId: string) => void
    managedSession: (worktreeId: string, sessionId: string) => void
  },
): boolean {
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
  return true
}

/**
 * Persist the current selection for the applied project so switching back
 * restores it. Skips while the catalog and applied project disagree (the
 * switch window), and never persists a selection the project does not own.
 */
export function createTargetRememberer(opts: {
  pid: () => string | undefined
  enabled: () => boolean
  applied: () => string | undefined
  selection: () => string | null
  owns: (sel: string) => boolean
  sessionId: () => string | undefined
  post: Parameters<typeof rememberTarget>[0]
}): void {
  createEffect(() => {
    const pid = opts.pid()
    if (!pid || !opts.enabled()) return
    // pid flips with the catalog push, before the new project's state is
    // applied. In that window selection() still belongs to the previous
    // project, so persisting it would poison this project's target.
    if (opts.applied() !== pid) return
    const sel = opts.selection()
    if (sel && sel !== LOCAL && !opts.owns(sel)) return
    rememberTarget(opts.post, pid, sel, opts.sessionId())
  })
}
