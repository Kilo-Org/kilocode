import { onCleanup } from "solid-js"
import type { BrowserReference } from "../../../src/shared/browser-feedback"
import type { SendIntent } from "../../../src/shared/prompt-send"
import type { ChatReferenceData, ReviewCommentEntry } from "../../../src/shared/review-comments"

/** `send` is the send the click asked for; undefined only appends the content and keeps the draft. */
export type AppendHandler = (value: string, send?: SendIntent) => void

/** Adds review comments to the composer draft, where they show as chips instead of markdown text. */
export type ReviewAppendHandler = (comments: ReviewCommentEntry[], send: SendIntent) => void

/** Lets the transcript quote, comment on and send passages of an answer through the composer. */
export type ReplyHandler = {
  /** The chat references in the draft. */
  pending: () => ChatReferenceData[]
  /** Adds a reference to the draft, or replaces the one with the same id. `focus` moves focus to the composer. */
  add: (reference: ChatReferenceData, focus: boolean) => void
  remove: (id: string) => void
  /** Sends one reference on its own. The draft and its other references stay. */
  send: (reference: ChatReferenceData, send?: SendIntent) => void
}

/** Adds an element picked in the Integrated Browser to the composer's reference list. */
export type ReferenceHandler = (reference: BrowserReference) => void

/**
 * Hands a composer function to its caller and clears it when the composer disposes. A caller that keeps this
 * function must not call it into a composer that already unmounted.
 */
export function registerAppend<T = AppendHandler>(report: ((value: T | undefined) => void) | undefined, value: T) {
  report?.(value)
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
