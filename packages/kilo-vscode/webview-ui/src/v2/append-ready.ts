import { onCleanup } from "solid-js"
import type { ReviewCommentEntry } from "../../../src/shared/review-comments"

export type AppendHandler = (value: string, send: boolean) => void

/** Adds review comments to the composer draft, where they show as chips instead of markdown text. */
export type ReviewAppendHandler = (comments: ReviewCommentEntry[], send: boolean) => void

/**
 * Hands the composer append function to its caller and clears it when the composer disposes. A caller that keeps
 * this function must not append into a composer that already unmounted.
 */
export function registerAppend(
  report: ((append: AppendHandler | undefined) => void) | undefined,
  append: AppendHandler,
) {
  report?.(append)
  onCleanup(() => report?.(undefined))
}

/** The review-comment counterpart of {@link registerAppend}. */
export function registerReviewAppend(
  report: ((append: ReviewAppendHandler | undefined) => void) | undefined,
  append: ReviewAppendHandler,
) {
  report?.(append)
  onCleanup(() => report?.(undefined))
}
