import type { SendIntent } from "../../../src/shared/prompt-send"
import type { ReviewCommentEntry } from "../../../src/shared/review-comments"

export type ReviewAppend = (comments: ReviewCommentEntry[], send: SendIntent) => void

interface PendingReview {
  comments: ReviewCommentEntry[]
  send: SendIntent
}

/**
 * Routes review comments to the chat prompt while it exists and holds them while it does not, for example when the
 * sidebar shows History. Batches queued while it was away are merged into one append so a burst does not send a
 * separate prompt for every comment. One Option-click in the merged batch sends all of it now.
 */
export function createReviewAppendQueue() {
  let append: ReviewAppend | undefined
  let pending: PendingReview[] = []

  const ready = (next?: ReviewAppend) => {
    append = next
    if (!append || pending.length === 0) return
    const comments = pending.flatMap((item) => item.comments)
    const send = pending.some((item) => item.send === "alternate") ? "alternate" : "enter"
    pending = []
    append(comments, send)
  }

  const push = (comments: ReviewCommentEntry[], send: SendIntent) => {
    if (append) {
      append(comments, send)
      return
    }
    pending.push({ comments, send })
  }

  return { ready, push }
}
