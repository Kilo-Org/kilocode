import { PUSH_INSTRUCTION, record } from "./review-comments"

/**
 * Marker for user-role prompts that Kilo composed on behalf of the user, such
 * as worktree updates or expanded slash-command templates. Stored in
 * `TextPart.metadata.kilo.injected` so it persists with the message. The
 * server stamps the same shape for slash commands in
 * `packages/opencode/src/kilocode/session/processor.ts`.
 */
export interface InjectedPrompt {
  /** Short label shown in the message header, e.g. "Update from base". */
  title: string
}

/** What the user bubble shows for a prompt that Kilo composed or extended. */
export interface InjectedView {
  /** Header label, e.g. "Sent by Kilo · /review branch". */
  label: string
  /** Collapsed body. Undefined when the full text is short enough to show as is. */
  preview?: string
}

const TITLE_LIMIT = 200

export function injectedMetadata(title: string): Record<string, unknown> {
  return { kilo: { injected: { title } } }
}

export function partInjected(metadata: unknown): InjectedPrompt | undefined {
  const kilo = record(record(metadata)?.kilo)
  const value = record(kilo?.injected)
  const title = value?.title
  if (typeof title !== "string" || !title.trim()) return undefined
  return { title: title.trim().slice(0, TITLE_LIMIT) }
}

/** Number of lines above which an injected prompt collapses to its first paragraph. */
export const COLLAPSE_LINES = 4

export function injectedPreview(text: string): string | undefined {
  const body = text.trim()
  if (body.split("\n").length <= COLLAPSE_LINES) return undefined
  return body.split(/\n\s*\n/, 1)[0]?.trim() || undefined
}

/**
 * Resolve the header and collapsed body for a user message. `text` is the
 * message body after review and browser feedback sections were removed.
 * Returns undefined for a plain user message.
 */
export function injectedView(metadata: unknown, text: string): InjectedView | undefined {
  const marked = partInjected(metadata)
  if (marked) return { label: `Sent by Kilo \u00B7 ${marked.title}`, preview: injectedPreview(text) }
  const body = text.trim()
  if (!body.startsWith(PUSH_INSTRUCTION)) return undefined
  const rest = body.slice(PUSH_INSTRUCTION.length).trim()
  if (!rest) return { label: "Sent by Kilo \u00B7 Fix pull request feedback" }
  return { label: "Kilo added: push fixes to the pull request", preview: rest }
}
