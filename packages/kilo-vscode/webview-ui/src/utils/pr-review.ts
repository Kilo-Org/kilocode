import { formatReviewCommentsMarkdown, type PRReviewCommentData } from "../../../src/shared/review-comments"
import type { WebviewMessage } from "../types/messages"

export function openPRComment(
  post: (message: WebviewMessage) => void,
  comment: PRReviewCommentData,
  sessionID?: string,
) {
  const event = new CustomEvent("kilo:open-pr-comment", { cancelable: true, detail: { comment, sessionID } })
  if (!window.dispatchEvent(event)) return
  post({ type: "openPRComment", comment, content: formatReviewCommentsMarkdown([comment]), sessionID })
}
