export type ReviewAppend = (value: string, send: boolean) => void

interface PendingReview {
  value: string
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
    const value = pending.map((item) => item.value).join("\n\n")
    const send = pending.some((item) => item.send)
    pending = []
    append(value, send)
  }

  const push = (value: string, send: boolean) => {
    if (append) {
      append(value, send)
      return
    }
    pending.push({ value, send })
  }

  return { ready, push }
}
