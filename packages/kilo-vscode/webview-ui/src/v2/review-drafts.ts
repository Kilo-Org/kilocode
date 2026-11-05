// Review-comment drafts and the prompt they compose, kept apart from the composer so tests can read them without a
// DOM. Same rules as v1's PromptInput.
import type { JsonValue } from "@opencode/client"
import {
  formatReviewCommentsMarkdown,
  pushInstruction,
  type ReviewCommentEntry,
  type ReviewMessageData,
} from "../../../src/shared/review-comments"

/** Merges comments by id. A later comment with the same id replaces the earlier one. */
export function mergeReviewComments(current: ReviewCommentEntry[], incoming: ReviewCommentEntry[]) {
  if (incoming.length === 0) return current
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()]
}

/**
 * Adds the review data to metadata that already carries other composer data, such as browser references. Both
 * producers write under `kilo`, so the two keys must merge instead of replacing each other.
 */
export function mergePromptMetadata(
  base: Record<string, JsonValue> | undefined,
  review: Record<string, JsonValue> | undefined,
) {
  if (!base || !review) return review ?? base
  const kilo = (value: JsonValue | undefined) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  return { ...base, ...review, kilo: { ...kilo(base.kilo), ...kilo(review.kilo) } }
}

/**
 * The text and metadata of one send. The review markdown prefix stays in the text, as v1 sent it, and the metadata
 * lets the transcript strip that prefix again. `push` is the `agentManager.pushFixes` setting; the user's own text
 * comes last so it can override the default push behavior.
 */
export function composeReviewPrompt(comments: ReviewCommentEntry[], body: string, push: boolean) {
  const draft = body.trim()
  if (comments.length === 0) return { text: draft }
  const review: ReviewMessageData = { version: 1, comments }
  const text = [formatReviewCommentsMarkdown(comments), pushInstruction(comments, push), draft]
    .filter(Boolean)
    .join("\n\n")
  // The review data is plain JSON by construction; its interface types have no index signature to prove that.
  const metadata = { kilo: { review } } as unknown as Record<string, JsonValue>
  return { text, metadata }
}
