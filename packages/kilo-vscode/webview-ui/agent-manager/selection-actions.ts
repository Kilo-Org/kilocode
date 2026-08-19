/**
 * Sidebar selection actions with per-project tab memory.
 *
 * Extracted from AgentManagerApp (file-size cap): selecting Local or a
 * worktree restores the last active tab of that context (session, pending
 * draft, terminal, or review) and falls back to the first available session.
 */

import { batch } from "solid-js"
import { LOCAL } from "./navigate"

interface TermState {
  hasRemembered: (sel: string, remembered: string | undefined) => boolean
  setActiveId: (id: string | undefined) => void
}

interface SessionLike {
  id: string
}

export interface SelectionActionDeps<T extends SessionLike> {
  saveTabMemory: () => void
  setReviewActive: (open: boolean) => void
  setSelection: (id: string) => void
  post: (msg: unknown) => void
  tabMemory: () => Record<string, string>
  terms: TermState
  /** Terminal state is keyed by project-namespaced context; map a plain
   *  selection ("local" or a worktree id) to its terminal-state key. */
  nsKey: (sel: string) => string
  activateTerminal: (id: string) => void
  setActivePendingId: (id: string | undefined) => void
  selectSession: (id: string) => void
  clearSession: () => void
  resetSession: () => void
  isPending: (id: string) => boolean
  isReviewTab: (remembered: string | undefined, sel: string) => boolean
}

export function restoreSessionAfterTerminal<T extends SessionLike>(input: {
  terminal: string | undefined
  remembered: string | undefined
  sessions: T[]
  isPending: (id: string) => boolean
  select: (id: string, pending: boolean) => void
  create: () => "ready" | "pending"
}): "none" | "ready" | "pending" {
  if (!input.terminal) return "none"
  const target = input.sessions.find((item) => item.id === input.remembered) ?? input.sessions[0]
  if (target) input.select(target.id, input.isPending(target.id))
  else return input.create()
  return "ready"
}

export function createSessionRestore<T extends SessionLike>(deps: {
  terminal: () => string | undefined
  selection: () => string | null
  remembered: (selection: string) => string | undefined
  sessions: () => T[]
  current: () => string | undefined
  pending: () => string | undefined
  isPending: (id: string) => boolean
  select: (id: string, pending: boolean) => void
  create: () => "ready" | "pending"
  remember: (selection: string, id: string) => void
}) {
  return {
    remember: () => {
      const selection = deps.selection()
      const id = deps.current() ?? deps.pending()
      if (selection !== null && id) deps.remember(selection, id)
    },
    restore: () => {
      const selection = deps.selection()
      return restoreSessionAfterTerminal({
        terminal: deps.terminal(),
        remembered: selection === null ? undefined : deps.remembered(selection),
        sessions: deps.sessions(),
        isPending: deps.isPending,
        select: deps.select,
        create: deps.create,
      })
    },
  }
}

/** Select the Local context: restore its remembered tab or fall back to the first session/draft. */
export function selectLocalAction<T extends SessionLike>(deps: SelectionActionDeps<T>, locals: T[]): void {
  deps.saveTabMemory()
  deps.post({ type: "agentManager.requestRepoInfo" })
  const remembered = deps.tabMemory()[LOCAL]
  batch(() => {
    deps.setReviewActive(false)
    deps.setSelection(LOCAL)
    if (deps.terms.hasRemembered(deps.nsKey(LOCAL), remembered)) {
      deps.activateTerminal(remembered!)
      return
    }
    deps.terms.setActiveId(undefined)
    const target = remembered ? locals.find((s) => s.id === remembered) : undefined
    const fallback = target ?? locals[0]
    if (fallback && !deps.isPending(fallback.id)) {
      deps.setActivePendingId(undefined)
      deps.selectSession(fallback.id)
    } else {
      deps.setActivePendingId(fallback && deps.isPending(fallback.id) ? fallback.id : undefined)
      deps.clearSession()
      deps.post({ type: "agentManager.showExistingLocalTerminal" })
    }
    deps.setReviewActive(deps.isReviewTab(remembered, LOCAL))
  })
}

/** Select a worktree: restore its remembered tab or fall back to its first session. */
export function selectWorktreeAction<T extends SessionLike>(
  deps: SelectionActionDeps<T>,
  worktreeId: string,
  sessions: T[],
): void {
  deps.saveTabMemory()
  const remembered = deps.tabMemory()[worktreeId]
  batch(() => {
    deps.setSelection(worktreeId)
    if (deps.terms.hasRemembered(deps.nsKey(worktreeId), remembered)) {
      deps.activateTerminal(remembered!)
      return
    }
    deps.terms.setActiveId(undefined)
    const target = remembered ? sessions.find((s) => s.id === remembered) : undefined
    const fallback = target ?? sessions[0]
    if (fallback) deps.selectSession(fallback.id)
    else deps.resetSession()
    deps.setReviewActive(deps.isReviewTab(remembered, worktreeId))
  })
}
