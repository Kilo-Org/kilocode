// Prompt navigator data: one item per user prompt, the tick entries the rail
// shows for them, and the preview text of the card rows.
import type { SessionMessageAssistant } from "@opencode/client"
import type { TranscriptQueuedRow, TranscriptRow } from "./transcript"

export interface PromptRailItem {
  key: string
  turn: string
  queued: boolean
  prompt: string
  answer: string
}

export type PromptRailEntry =
  | { type: "prompt"; item: PromptRailItem; index: number }
  | { type: "overflow"; count: number; index: number }
  | { type: "history" }

const PROMPT_LIMIT = 160
const ANSWER_LIMIT = 220

/**
 * Height of the tallest card row (padding + a one-line prompt + a two-line
 * answer). Sizes the navigator's virtualized rows; the rail's own fit cap is
 * measured in tick spacing instead, since a tick is only a hairline.
 */
export const ROW_HEIGHT = 76
/** Vertical padding reserved at the top and bottom of the rail. */
export const RAIL_INSET = 24
/** Natural spacing between ticks, and the tightest they are allowed to pack. */
export const TICK_STEP = 14
export const TICK_MIN = 7

/**
 * How many ticks fit the available transcript height. Measured in tick
 * spacing, not card row height: a tick is a 1.5px line, so the rail holds
 * several times more prompts than the navigator can list at once, and
 * summarizing at the card's row count would hide prompts that have room to
 * show. The complete prompt list lives in the bounded navigator.
 */
export function capacity(height: number): number {
  return Math.floor((height - RAIL_INSET) / TICK_MIN)
}

export function historyAction(before: number, after: number, more: boolean): "stop" | "load" | "jump" {
  if (after <= before) return "stop"
  return more ? "load" : "jump"
}

// The card never renders markdown — user message text shows literally, and
// assistant text should too. Code spans (inline and fenced) are dropped, and
// link URLs / images are stripped rather than parsed, so bracket text inside
// inline code stays out instead of half-stripped.
export function previewText(raw: string): string {
  const segments = raw.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  const text = segments.map((segment, index) => (index % 2 === 1 ? "" : stripLinks(segment))).join(" ")
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*>+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

function stripLinks(text: string) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
}

function text(parts: SessionMessageAssistant["content"], limit: number): string {
  const joined = parts
    .filter((part) => part.type === "text" && !!part.text.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
  return truncate(previewText(joined), limit)
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

export function promptItems(
  rows: readonly TranscriptRow[],
  queued: readonly TranscriptQueuedRow[] = [],
): PromptRailItem[] {
  const items = rows.flatMap((row): PromptRailItem[] =>
    row.type === "user"
      ? [
          {
            key: row.key,
            turn: row.turn,
            queued: false,
            prompt: truncate(previewText(row.message.text), PROMPT_LIMIT),
            answer: "",
          },
        ]
      : [],
  )
  const byTurn = new Map(items.map((item) => [item.turn, item]))

  // One pass fills every answer: assistant rows follow their user row and carry
  // the same turn id. The first step that has text is the preview; the chunks of
  // that step keep appending until the answer limit is reached, so a reply split
  // into rows reads as one paragraph.
  const carrier = new Map<string, string>()
  for (const row of rows) {
    if (row.type !== "assistant") continue
    const item = byTurn.get(row.turn)
    if (!item) continue
    const id = carrier.get(item.turn)
    if (item.answer && id && row.message.id !== id) continue
    const value = text(row.parts, ANSWER_LIMIT)
    if (!value) continue
    if (!id) carrier.set(item.turn, row.message.id)
    item.answer = truncate(item.answer ? `${item.answer} ${value}` : value, ANSWER_LIMIT)
  }

  // A prompt can carry no text at all (image-only or file-only message). Rather
  // than render a blank row, promote the answer into the label so the row still
  // says something; if neither has text the card falls back to its placeholder.
  for (const item of items) {
    if (item.prompt || !item.answer) continue
    item.prompt = truncate(item.answer, PROMPT_LIMIT)
    item.answer = ""
  }

  for (const row of queued) {
    items.push({
      key: row.key,
      turn: row.key,
      queued: true,
      prompt: truncate(previewText(row.item.payload.text), PROMPT_LIMIT),
      answer: "",
    })
  }
  return items
}

export function railEntries(items: PromptRailItem[], capacity: number, history = false): PromptRailEntry[] {
  if (capacity < 1) return []
  if (!history && items.length <= capacity) {
    return items.map((item, index) => ({ type: "prompt", item, index }))
  }
  if (capacity === 1) {
    if (history) return [{ type: "history" }]
    const index = items.length - 1
    const item = items[index]
    return item ? [{ type: "prompt", item, index }] : []
  }
  if (capacity === 2) {
    const item = items.at(-1)
    const latest = item ? [{ type: "prompt" as const, item, index: items.length - 1 }] : []
    if (history) return [{ type: "history" }, ...latest]
    const first = items[0]
    return first ? [{ type: "prompt", item: first, index: 0 }, ...latest] : latest
  }

  const count = Math.min(items.length, capacity - 2)
  const start = items.length - count
  const recent = items.slice(start).map((item, offset) => ({
    type: "prompt" as const,
    item,
    index: start + offset,
  }))
  const prefix: PromptRailEntry[] = history
    ? [{ type: "history" }]
    : items[0]
      ? [{ type: "prompt", item: items[0], index: 0 }]
      : []
  const hidden = start - (history ? 0 : 1)
  if (hidden < 1) return [...prefix, ...recent]
  return [...prefix, { type: "overflow", count: hidden, index: history ? 0 : 1 }, ...recent]
}
