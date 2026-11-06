import type { ReviewCommentEntry } from "../../../src/shared/review-comments"

export type ReviewAppend = (comments: ReviewCommentEntry[], send: boolean) => void

interface PendingReview {
  comments: ReviewCommentEntry[]
  send: boolean
}

/**
 * Routes review comments to the chat prompt while it exists and holds them while it does not, for example when the
 * sidebar shows History. Batches queued while it was away are merged into one append so a burst does not send a
 * separate prompt for every comment.
 */
export function createReviewAppendQueue() {
  let append: ReviewAppend | undefined
  let pending: PendingReview[] = []

  const ready = (next?: ReviewAppend) => {
    append = next
    if (!append || pending.length === 0) return
    const comments = pending.flatMap((item) => item.comments)
    const send = pending.some((item) => item.send)
    pending = []
    append(comments, send)
  }

  const push = (comments: ReviewCommentEntry[], send: boolean) => {
    if (append) {
      append(comments, send)
      return
    }
    pending.push({ comments, send })
  }

  return { ready, push }
}
