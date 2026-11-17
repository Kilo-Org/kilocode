/**
 * Tab behavior of the Agent Manager: placing a new session into Local or a worktree, restoring the remembered tab,
 * and closing a tab onto its neighbor. Agent Manager tabs are placed by the panel, but the sessions they show live in
 * the v2 store of their directory.
 */
import { batch } from "solid-js"
import { addPendingTab, openSessionTab, replacePendingTab } from "../src/utils/local-tabs"
import { LOCAL } from "./navigate"
import { PENDING_PREFIX } from "./tab-ids"

export const isPendingTab = (id: string) => id.startsWith(PENDING_PREFIX)

export function createLocalTabPlacement(opts: {
  ids: () => string[]
  setIds: (next: string[] | ((prev: string[]) => string[])) => void
  appendOrder: (key: string, id: string) => void
  replaceOrder: (key: string, oldId: string, id: string) => void
  /**
   * A draft promoted to a real session keeps the context's remembered tab: the draft was the visible tab when the
   * user left, and it no longer exists under its old id. Without this, returning falls back to the leftmost tab.
   */
  replaceRemembered: (from: string, to: string) => void
  activePending: () => string | undefined
  setActivePending: (id: string | undefined) => void
  setActiveTerminal: (id: undefined) => void
  clearSession: () => void
  selectSession: (id: string) => void
  setSelection: (id: string) => void
  setReviewActive: (open: boolean) => void
  focus: () => void
  resume: (id: string) => void
}) {
  const addPending = () => {
    const id = `${PENDING_PREFIX}${crypto.randomUUID()}`
    const next = addPendingTab({ ids: opts.ids(), active: opts.activePending() }, id)
    opts.setIds(next.ids)
    opts.appendOrder(LOCAL, id)
    opts.setActiveTerminal(undefined)
    opts.setActivePending(id)
    opts.clearSession()
    return id
  }

  const place = (id: string, pending: string | undefined, active: string | undefined) => {
    opts.resume(id)
    const existing = opts.ids().includes(id)
    const next = pending
      ? replacePendingTab({ ids: opts.ids(), active }, pending, id)
      : openSessionTab({ ids: opts.ids(), active }, id)
    opts.setIds(next.ids)
    if (pending) {
      opts.replaceOrder(LOCAL, pending, id)
      opts.replaceRemembered(pending, id)
    }
    if (!pending && !existing) opts.appendOrder(LOCAL, id)
    if (pending && pending === active) opts.setActivePending(undefined)
  }

  const focusLocal = (id: string) => {
    const pending = opts.activePending()
    const replace =
      pending && !opts.ids().includes(id) && opts.ids().includes(pending) ? pending : undefined
    place(id, replace, replace)
    opts.setActivePending(undefined)
    opts.setActiveTerminal(undefined)
    opts.setReviewActive(false)
    opts.setSelection(LOCAL)
    opts.selectSession(id)
    opts.focus()
  }

  return { addPending, place, focusLocal }
}

export function selectSessionTab(opts: {
  id: string
  pending: boolean
  selection: () => string | null
  remember: (selection: string, tab: string) => void
  setActivePending: (id: string | undefined) => void
  clearSession: () => void
  selectSession: (id: string) => void
  setReviewActive: (open: boolean) => void
}) {
  batch(() => {
    const selection = opts.selection()
    if (selection !== null) opts.remember(selection === LOCAL ? LOCAL : selection, opts.id)
    opts.setReviewActive(false)
    if (opts.pending) {
      opts.setActivePending(opts.id)
      opts.clearSession()
      return
    }
    opts.setActivePending(undefined)
    opts.selectSession(opts.id)
  })
}

export function newTabForSelection(opts: {
  selection: string | null
  addPending: () => string
  postToWorktree: (worktreeId: string) => void
  /** Leave an active terminal tab, which covers the session area, so the new session shows when it opens. */
  clearTerminal: () => void
}): "ready" | "pending" {
  if (opts.selection === LOCAL) {
    opts.addPending()
    return "ready"
  }
  if (!opts.selection) return "pending"
  opts.clearTerminal()
  opts.postToWorktree(opts.selection)
  return "pending"
}

export function closeSessionTab(opts: {
  sessionId: string
  notify?: boolean
  order: string[]
  isActive: boolean
  next: string | undefined
  isPending: (id: string) => boolean
  setActivePending: (id: string | undefined) => void
  clearSession: () => void
  selectSession: (id: string) => void
  forgetFocus: (id: string) => void
  local: Set<string>
  dismiss: (id: string) => void
  removeLocal: (id: string) => void
  postClose: (id: string) => void
  restoreFocus: () => void
}) {
  const pending = opts.isPending(opts.sessionId)
  batch(() => {
    // Remember the close before clearing the shown session: a state push that still lists the tab must not restore it.
    if (!pending) opts.dismiss(opts.sessionId)
    if (opts.isActive) {
      const next = opts.next
      if (next && opts.isPending(next)) {
        opts.setActivePending(next)
        opts.clearSession()
      }
      if (next && !opts.isPending(next)) {
        opts.setActivePending(undefined)
        opts.selectSession(next)
      }
      if (!next) {
        opts.setActivePending(undefined)
        opts.clearSession()
      }
    }
    opts.forgetFocus(opts.sessionId)
    if (pending || opts.local.has(opts.sessionId)) opts.removeLocal(opts.sessionId)
  })
  if (opts.notify !== false) opts.postClose(opts.sessionId)
  opts.restoreFocus()
}
