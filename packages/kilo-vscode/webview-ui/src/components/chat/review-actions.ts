import { createContext, useContext } from "solid-js"
import type { PRReviewCommentData } from "../../../../src/shared/review-comments"

/**
 * Surface actions a review comment row needs from the view around it. The Agent Manager provides both; the sidebar
 * provides neither and opens files through its own host message.
 */
export interface ReviewCommentActions {
  /** Opens a PR comment in the PR diff panel. Absent where the surface has no PR panel. */
  showInDiff?: (comment: PRReviewCommentData, sessionID?: string) => void
  openFile?: (filePath: string, line: number | undefined, sessionID?: string) => void
}

export const ReviewCommentActionsContext = createContext<ReviewCommentActions>()

export function useReviewCommentActions(): ReviewCommentActions {
  return useContext(ReviewCommentActionsContext) ?? {}
}
