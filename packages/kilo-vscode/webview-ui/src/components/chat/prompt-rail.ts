import type { Part } from "../../types/messages"
import type { TranscriptRow } from "../../context/transcript-rows"

export interface PromptRailItem {
  key: string
  turn: string
  queued: boolean
  prompt: string
  answer: string
}

const PROMPT_LIMIT = 160
const ANSWER_LIMIT = 220

/**
 * Height of the tallest card row (padding + a one-line prompt + a two-line
 * answer), and the unit the fit cap is measured in. Deliberately the worst
 * case rather than an average: "only show what fits" should stay true for a
 * card whose rows all wrap, not just for a lucky mix of short ones.
 */
export const ROW_HEIGHT = 76
/** Vertical padding reserved at the top and bottom of the rail. */
export const RAIL_INSET = 24

/**
 * How many prompts fit the available transcript height. The card and the rail
 * always render the same set, so this one number drives both.
 */
export function capacity(height: number): number {
  return Math.floor((height - RAIL_INSET) / ROW_HEIGHT)
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

export function railItems(items: PromptRailItem[], capacity: number): PromptRailItem[] {
  if (capacity < 1) return []
  return items.slice(-capacity)
}
