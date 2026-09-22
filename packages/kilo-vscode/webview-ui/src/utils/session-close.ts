import { closableRightOf, closeToRight, type CloseToRightDeps } from "../../agent-manager/close-to-right"

/**
 * The Agent Manager close helpers also cover terminal and review tabs. The
 * sidebar tab strip only holds session tabs, so this id never matches one and
 * the terminal and review handlers are no-ops.
 */
const REVIEW_ID = ""

const none = () => {}

export interface SessionTabBar {
  ids: () => readonly string[]
  visible: () => string | undefined
  isPinned: (id: string) => boolean
  close: (id: string) => void
  reveal: (id: string) => void
}

/** Close-to-right deps for a session-only tab bar. */
export function sessionCloseDeps(bar: SessionTabBar): CloseToRightDeps {
  return {
    REVIEW_TAB_ID: REVIEW_ID,
    tabIds: bar.ids,
    visibleTabId: bar.visible,
    isPending: () => false,
    isPinned: bar.isPinned,
    activateTerminal: none,
    deactivateTerminal: none,
    closeTerminal: none,
    closeReview: none,
    selectReviewTab: none,
    selectSessionTab: (id) => bar.reveal(id),
    sessionClose: bar.close,
  }
}

/** Session tabs after `target` in rendered order that Close to the Right would close. */
export function closableRight(target: string, deps: CloseToRightDeps): string[] {
  return closableRightOf(target, deps.tabIds(), deps.REVIEW_TAB_ID, deps.isPinned)
}

export { closeToRight }
