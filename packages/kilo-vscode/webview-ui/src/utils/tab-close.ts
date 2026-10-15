import { isTerminalTabId } from "./terminal-tab-id"

/** The subset of tab-bar handlers that closing every other tab needs. */
export interface CloseOthersDeps {
  REVIEW_TAB_ID: string
  tabIds: () => readonly string[]
  isPending: (id: string) => boolean
  activateTerminal: (id: string) => void
  deactivateTerminal: () => void
  closeTerminal: (id: string) => void
  closeReview: () => void
  selectReviewTab: () => void
  selectSessionTab: (id: string, pending: boolean) => void
  sessionClose: (id: string) => void
  isPinned: (id: string) => boolean
}

/** Reveal `target` and clear whichever other tab kind currently owns the view. */
export function reveal(target: string, deps: CloseOthersDeps) {
  const terminal = isTerminalTabId(target)
  const review = target === deps.REVIEW_TAB_ID
  if (terminal) deps.activateTerminal(target)
  if (!terminal) deps.deactivateTerminal()
  if (review) deps.selectReviewTab()
  if (!terminal && !review) deps.selectSessionTab(target, deps.isPending(target))
}

/**
 * Close every tab except `target`.
 *
 * Reveal the target first. Closing the previously active tab afterwards
 * cannot pull selection onto a neighbor that is itself about to close, and a
 * session target cannot stay hidden behind an active terminal. The ids are
 * snapshotted before the closes mutate the tab list.
 */
export function closeOthers(target: string, deps: CloseOthersDeps) {
  const ids = [...deps.tabIds()]
  reveal(target, deps)
  for (const id of ids) {
    if (id === target) continue
    if (isTerminalTabId(id)) {
      deps.closeTerminal(id)
      continue
    }
    if (id === deps.REVIEW_TAB_ID) {
      deps.closeReview()
      continue
    }
    // Pinned tabs survive Close Others, the same way they do in VS Code.
    if (deps.isPinned(id)) continue
    deps.sessionClose(id)
  }
}

/** The subset of tab-bar handlers Close to the Right needs, plus the visible tab. */
export interface CloseToRightDeps extends CloseOthersDeps {
  /** Id of the currently visible tab, or undefined when nothing is selected. */
  visibleTabId: () => string | undefined
}

/**
 * Every tab rendered after `target` that Close to the Right would close.
 *
 * Pinned session tabs survive, the same way they do for Close Others, so a
 * target with only pinned tabs to its right has nothing to close. Terminal and
 * review tabs are never pinned and always count.
 */
export function closableRightOf(
  target: string,
  ids: readonly string[],
  reviewId: string,
  isPinned: (id: string) => boolean,
): string[] {
  const index = ids.indexOf(target)
  if (index < 0) return []
  return ids.slice(index + 1).filter((id) => isTerminalTabId(id) || id === reviewId || !isPinned(id))
}

/**
 * Close every tab to the right of `target` in rendered order, leaving tabs
 * before it alone.
 *
 * Unlike Close Others, selection does not move to the target. It changes only
 * when the visible tab is one of the tabs being closed, in which case the
 * target is revealed first so a closing neighbor cannot take selection.
 */
export function closeToRight(target: string, deps: CloseToRightDeps) {
  const ids = [...deps.tabIds()]
  const closing = closableRightOf(target, ids, deps.REVIEW_TAB_ID, deps.isPinned)
  if (closing.length === 0) return
  const visible = deps.visibleTabId()
  if (visible != null && closing.includes(visible)) reveal(target, deps)
  for (const id of closing) {
    if (isTerminalTabId(id)) {
      deps.closeTerminal(id)
      continue
    }
    if (id === deps.REVIEW_TAB_ID) {
      deps.closeReview()
      continue
    }
    deps.sessionClose(id)
  }
}
