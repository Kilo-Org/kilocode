import { isTerminalTabId } from "./terminal/state"

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
  const terminal = isTerminalTabId(target)
  const review = target === deps.REVIEW_TAB_ID
  if (terminal) deps.activateTerminal(target)
  if (!terminal) deps.deactivateTerminal()
  if (review) deps.selectReviewTab()
  if (!terminal && !review) deps.selectSessionTab(target, deps.isPending(target))
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
