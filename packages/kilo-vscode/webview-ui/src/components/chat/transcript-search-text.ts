import type { TranscriptRow } from "../../context/transcript-rows"

/** Character range one message part occupies within a row's searchable text. */
export interface SearchTextRange {
  start: number
  end: number
  partId: string
}

/**
 * Chat transcript search only scans real message text: user prompts and
 * assistant replies. Tool calls and their output (bash included), reasoning
 * blocks, file attachments, and error rows are deliberately out of scope.
 * They dominate a long transcript by volume, so matching them buries the
 * conversational text a search is actually after.
 *
 * Returns the row's combined search text plus, for every part that contributed
 * to it, the character range it occupies. The range lets a match be attributed
 * back to the part it came from, so highlighting can scan just that part's DOM
 * subtree instead of every element in the row.
 */
export function rowSearchText(row: TranscriptRow): { text: string; ranges: SearchTextRange[] } {
  if (row.type !== "user" && row.type !== "assistant") return { text: "", ranges: [] }
  // User message text renders literally (never parsed as markdown), so
  // [label](url) shows with its brackets and URL intact. Assistant text goes
  // through the real Markdown renderer, which hides link/image URLs, so strip
  // those there to keep the match count aligned with the visible characters.
  const markdown = row.type === "assistant"
  const chunks: string[] = []
  const ranges: SearchTextRange[] = []
  let pos = 0
  for (const part of row.parts) {
    if (part.type !== "text" || part.synthetic) continue
    const text = markdown ? stripMarkdownLinkUrls(part.text) : part.text
    if (!text) continue
    if (chunks.length > 0) pos += 1 // account for the "\n" chunk joiner below
    chunks.push(text)
    ranges.push({ start: pos, end: pos + text.length, partId: part.id })
    pos += text.length
  }
  return { text: chunks.join("\n"), ranges }
}

// Markdown link/image URLs are part of the raw source text but are never
// rendered as visible text (only used as the href/src attribute), so a common
// assistant pattern like [marked.tsx](path/to/marked.tsx) makes the query
// match twice in raw text but appear only once in the DOM. Strips that hidden
// half so counting mirrors what's actually on screen. Images are removed
// entirely (their alt text isn't shown unless the image fails to load); links
// keep only their visible label.
//
// Code fences/spans suppress all inline markdown parsing, so bracket/paren
// text written inside one renders as literal, fully visible text. Split those
// segments out first and leave them alone, or two genuinely visible
// occurrences would wrongly collapse into one.
function stripMarkdownLinkUrls(text: string): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return segments.map((segment, i) => (i % 2 === 1 ? segment : stripLinks(segment))).join("")
}

export function stripLinks(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
}
