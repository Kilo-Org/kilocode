import { escapeRegExp } from "../utils/escape-regexp"
import type { TranscriptRow } from "./transcript"
import { rowSearchText } from "./transcript-search-text"

export interface SearchMatch {
  key: string
  /** Index (0-based) of this occurrence among all matches within the same row. */
  occurrence: number
  /** id of the message part this occurrence falls within, if it could be
   * attributed to one — lets highlighting scan just that part's DOM subtree
   * instead of every element in the row. */
  partId?: string
}

/** Literal, whole-word, case and regex pattern for the search query. */
export function buildSearchPattern(
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  regex: boolean,
): RegExp | undefined {
  if (!query) return undefined
  try {
    const pattern = regex ? query : escapeRegExp(query)
    // Unicode-aware boundary: plain `\b` only treats ASCII letters, digits
    // and underscore as "word" characters, so it silently breaks whole-word
    // matching for Cyrillic, Arabic, CJK and other non-ASCII text.
    if (!wholeWord) return new RegExp(pattern, matchCase ? "gu" : "giu")
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])`, matchCase ? "gu" : "giu")
  } catch {
    return undefined
  }
}

/** Every occurrence in the transcript rows, in row order. */
export function searchMatches(rows: readonly TranscriptRow[], pattern: RegExp | undefined): SearchMatch[] {
  if (!pattern) return []
  const result: SearchMatch[] = []
  for (const row of rows) {
    const { text, ranges } = rowSearchText(row)
    pattern.lastIndex = 0
    let occurrence = 0
    let hit = pattern.exec(text)
    while (hit) {
      const start = hit.index
      const end = start + hit[0].length
      if (hit[0].length === 0) {
        pattern.lastIndex += 1
        hit = pattern.exec(text)
        continue
      }
      // A hit that is not fully inside one part cannot be attributed to that
      // part's DOM subtree. Leave it unattributed so the highlighter scans the
      // whole row instead of a scope where the match cannot appear.
      const range = ranges.find((item) => start >= item.start && end <= item.end)
      result.push({ key: row.key, occurrence, partId: range?.partId })
      occurrence += 1
      hit = pattern.exec(text)
    }
  }
  return result
}
