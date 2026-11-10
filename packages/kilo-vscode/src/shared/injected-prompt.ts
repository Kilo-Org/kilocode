import type { JsonValue } from "@opencode/client"
import { PUSH_INSTRUCTION, record } from "./review-comments"

/**
 * Marker for user-role prompts that Kilo composed on behalf of the user, such
 * as worktree updates or expanded slash-command templates. Stored in the user
 * message metadata as `kilo.injected` so it persists with the message. The
 * server stamps the same shape for command prompts in
 * `packages/core/src/plugin/command.ts` and
 * `packages/core/src/config/plugin/command.ts`.
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
  /** Session that delivered the prompt for another session, when the Agent Manager marked it. */
  source?: string
  /** The body without the source marker, so the bubble and Copy leave out the marker. */
  text: string
}

const TITLE_LIMIT = 200

// An Agent Manager prompt ends with the session that sent it, written by `agent-manager/prompt-attribution.ts`.
// Composer and server trimming can leave the comment after one newline instead of the two the writer adds.
const ATTRIBUTION = /\n+<!-- kilo-agent-manager source=(\S+) -->$/

export function injectedMetadata(title: string): { [key: string]: JsonValue } {
  return { kilo: { injected: { title } } }
}

export function partInjected(metadata: unknown): InjectedPrompt | undefined {
  const kilo = record(record(metadata)?.kilo)
  const value = record(kilo?.injected)
  const title = value?.title
  if (typeof title !== "string" || !title.trim()) return undefined
  return { title: title.trim().slice(0, TITLE_LIMIT) }
}

export function injectedPreview(text: string): string | undefined {
  const body = text.trim()
  // A prompt long enough to push the conversation away collapses to its first paragraph.
  if (body.split("\n").length <= 4) return undefined
  const first = body.split(/\n\s*\n/, 1)[0]?.trim()
  return first && first !== body ? first : undefined
}

/**
 * Resolve the header and collapsed body for a user message. `text` is the
 * message body after review and browser feedback sections were removed.
 * Returns undefined for a plain user message.
 */
export function injectedView(metadata: unknown, text: string): InjectedView | undefined {
  const source = text.match(ATTRIBUTION)?.[1]
  // Templates and composed prompts carry the blank lines they were built from; the bubble and Copy show the same
  // trimmed body so neither keeps an empty first or last line.
  const body = text.replace(ATTRIBUTION, "").trim()
  // A prompt another session delivered reads as coming from Kilo, whatever else it carries.
  if (source) return { label: "Sent by Kilo from another session", source, text: body }
  const marked = partInjected(metadata)
  if (marked) return { label: `Sent by Kilo \u00B7 ${marked.title}`, preview: injectedPreview(body), text: body }
  if (!body.startsWith(PUSH_INSTRUCTION)) return undefined
  const rest = body.slice(PUSH_INSTRUCTION.length).trim()
  if (!rest) return { label: "Sent by Kilo \u00B7 Fix pull request feedback", text: body }
  return { label: "Kilo added: push fixes to the pull request", preview: rest, text: body }
}
