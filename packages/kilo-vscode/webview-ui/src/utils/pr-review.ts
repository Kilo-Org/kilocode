import type { PRReviewCommentData } from "../../../src/shared/review-comments"

/**
 * Opens a PR comment in the diff panel that listens for `kilo:open-pr-comment`. Only the Agent Manager has that
 * panel. The sidebar has no PR surface and no host message for it, so there an unhandled event opens nothing.
 */
export function openPRComment(comment: PRReviewCommentData, sessionID?: string) {
  window.dispatchEvent(new CustomEvent("kilo:open-pr-comment", { cancelable: true, detail: { comment, sessionID } }))
}
