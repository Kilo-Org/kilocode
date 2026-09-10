import type { Part } from "../../types/messages"
import type { TranscriptRow } from "../../context/transcript-rows"

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
// link URLs / images are stripped rather than parsed (mirrors MessageList's
// stripMarkdownLinkUrls split so bracket text inside inline code stays out,
// not half-stripped).
export function previewText(raw: string): string {
  const segments = raw.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  const text = segments.map((segment, i) => (i % 2 === 1 ? "" : stripLinks(segment))).join(" ")
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*>+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

function stripLinks(text: string) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
}

function text(parts: Part[], limit: number): string {
  const joined = parts
    .filter((part) => part.type === "text" && !part.synthetic && part.text.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
  return truncate(previewText(joined), limit)
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

export function promptItems(rows: TranscriptRow[]): PromptRailItem[] {
  const items: PromptRailItem[] = []
  for (const row of rows) {
    if (row.type !== "user") continue
    items.push({ key: row.key, turn: row.turn, queued: row.queued, prompt: text(row.parts, PROMPT_LIMIT), answer: "" })
  }
  // Answer text is grouped by turn so one pass fills every item; assistant
  // rows follow their user row and carry the same `turn` id.
  let index = 0
  for (const row of rows) {
    if (row.type === "user") {
      index += 1
      continue
    }
    if (row.type !== "assistant" || index === 0) continue
    const item = items[index - 1]!
    if (item.turn !== row.turn || item.answer) continue
    const value = text(row.parts, ANSWER_LIMIT)
    if (value) item.answer = value
  }
  // A prompt can carry no text at all (image-only or file-only message). Rather
  // than render a blank row, promote the answer into the label so the row still
  // says something; if neither has text the card falls back to its placeholder.
  for (const item of items) {
    if (item.prompt || !item.answer) continue
    item.prompt = truncate(item.answer, PROMPT_LIMIT)
    item.answer = ""
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
