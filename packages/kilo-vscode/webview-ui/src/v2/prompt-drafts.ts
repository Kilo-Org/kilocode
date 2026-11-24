import type { BrowserReference } from "../../../src/shared/browser-feedback"
import type { ReviewCommentEntry } from "../../../src/shared/review-comments"
import type { SessionSearchItem } from "../../../src/protocol"

// Browser references picked for each draft, kept with the same key as the draft text.
export const references = new Map<string, BrowserReference[]>()

// Pending review comments follow the same key as the text, so switching sessions neither loses nor mixes them.
export const reviewDrafts = new Map<string, ReviewCommentEntry[]>()

// The exact `@` mentions of each draft. A path with spaces or a past-chat title cannot be found again from the text
// alone, so a draft keeps the tokens it had, with the same key as the text.
export const mentionDrafts = new Map<string, { paths: string[]; sessions: SessionSearchItem[] }>()

export function saveReviewDraft(key: string | undefined, comments: ReviewCommentEntry[]) {
  if (!key) return
  if (comments.length === 0) reviewDrafts.delete(key)
  else reviewDrafts.set(key, comments)
}
