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
  forSelection: (sel: string) => { id: string }[]
  hasRemembered: (sel: string, remembered: string | undefined) => boolean
  setActiveId: (id: string | undefined) => void
}

interface SessionLike {
  id: string
}

export function rememberSelectionTab(
  set: (selection: string, tab: string) => void,
  selection: string | null,
  tab: string,
) {
  if (selection !== null) set(selection === LOCAL ? LOCAL : selection, tab)
}

export function createTabMemory(opts: {
  selection: () => string | null
  tab: () => string | undefined
  multi: () => boolean
  applied: () => string | undefined
  active: () => string | undefined
  owns: (selection: string) => boolean
  pending: (id: string) => boolean
  locals: () => string[]
  localTab?: (id: string) => boolean
  set: (selection: string, tab: string) => void
}) {
  return () => {
    const sel = opts.selection()
    const tab = opts.tab()
    if (sel === null || !tab) return
    if (opts.multi() && opts.applied() !== opts.active()) return
    if (
      opts.multi() &&
      !(sel === LOCAL ? (opts.localTab?.(tab) ?? (opts.pending(tab) || opts.locals().includes(tab))) : opts.owns(sel))
    )
      return
    rememberSelectionTab(opts.set, sel, tab)
  }
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
  focusLocal: (id: string) => void
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

function terminal(
  deps: SelectionActionDeps<SessionLike>,
  selection: string,
  remembered: string | undefined,
  empty: boolean,
): string | undefined {
  const key = deps.nsKey(selection)
  const known = deps.terms.hasRemembered(key, remembered)
  if (!known && (!empty || deps.isReviewTab(remembered, selection))) return
  return known ? remembered : deps.terms.forSelection(key).at(0)?.id
}

/** Select the Local context: restore its remembered tab or fall back to the first session/draft. */
export function selectLocalAction<T extends SessionLike>(
  deps: SelectionActionDeps<T>,
  locals: T[],
  ids: string[] = [],
): void {
  deps.saveTabMemory()
  deps.post({ type: "agentManager.requestRepoInfo" })
  const remembered = deps.tabMemory()[LOCAL]
  batch(() => {
    deps.setReviewActive(false)
    deps.setSelection(LOCAL)
    const id = terminal(deps, LOCAL, remembered, locals.length === 0 && ids.length === 0)
    if (id) {
      deps.activateTerminal(id)
      return
    }
    deps.terms.setActiveId(undefined)
    const real = locals.filter((item) => !deps.isPending(item.id))
    const target = remembered ? real.find((s) => s.id === remembered) : undefined
    const draft = remembered && deps.isPending(remembered) ? remembered : undefined
    const fallback =
      target?.id ??
      draft ??
      (remembered && ids.includes(remembered) ? remembered : undefined) ??
      real[0]?.id ??
      ids[0] ??
      locals.find((item) => deps.isPending(item.id))?.id
    if (fallback && !deps.isPending(fallback)) {
      deps.setActivePendingId(undefined)
      deps.focusLocal(fallback)
    } else {
      deps.setActivePendingId(fallback && deps.isPending(fallback) ? fallback : undefined)
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
  ids: string[] = [],
): void {
  deps.saveTabMemory()
  const remembered = deps.tabMemory()[worktreeId]
  batch(() => {
    deps.setSelection(worktreeId)
    const id = terminal(deps, worktreeId, remembered, sessions.length === 0 && ids.length === 0)
    if (id) {
      deps.activateTerminal(id)
      return
    }
    deps.terms.setActiveId(undefined)
    const target = remembered ? sessions.find((s) => s.id === remembered) : undefined
    const fallback =
      target?.id ?? (remembered && ids.includes(remembered) ? remembered : undefined) ?? sessions[0]?.id ?? ids[0]
    if (fallback) deps.selectSession(fallback)
    else deps.resetSession()
    deps.setReviewActive(deps.isReviewTab(remembered, worktreeId))
  })
}
