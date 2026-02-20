import type { FillInAtCursorSuggestion, MatchingSuggestionResult } from "../types"

export interface MatchingSuggestionWithFillIn extends MatchingSuggestionResult {
  fillInAtCursor: FillInAtCursorSuggestion
}

const MIN_DEBOUNCE_DELAY_MS = 150
const MAX_DEBOUNCE_DELAY_MS = 1000

/**
 * Find a matching suggestion from history based on current prefix and suffix.
 * Searches from most recent to least recent.
 */
export function findMatchingSuggestion(
  prefix: string,
  suffix: string,
  suggestionsHistory: FillInAtCursorSuggestion[],
): MatchingSuggestionWithFillIn | null {
  for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
    const fillInAtCursor = suggestionsHistory[i]!

    if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
      return { text: fillInAtCursor.text, matchType: "exact", fillInAtCursor }
    }

    if (fillInAtCursor.text !== "" && prefix.startsWith(fillInAtCursor.prefix) && suffix === fillInAtCursor.suffix) {
      const typedContent = prefix.substring(fillInAtCursor.prefix.length)
      if (fillInAtCursor.text.startsWith(typedContent)) {
        return {
          text: fillInAtCursor.text.substring(typedContent.length),
          matchType: "partial_typing",
          fillInAtCursor,
        }
      }
    }

    if (fillInAtCursor.text !== "" && fillInAtCursor.prefix.startsWith(prefix) && suffix === fillInAtCursor.suffix) {
      const deletedContent = fillInAtCursor.prefix.substring(prefix.length)
      return { text: deletedContent + fillInAtCursor.text, matchType: "backward_deletion", fillInAtCursor }
    }
  }
  return null
}

/**
 * Counts the number of lines in a text string.
 * A single trailing newline does not count as an additional line.
 */
export function countLines(text: string): number {
  if (text === "") return 0
  const lineBreakCount = (text.match(/\r?\n/g) || []).length
  const endsWithLineBreak = text.endsWith("\n")
  return lineBreakCount + 1 - (endsWithLineBreak ? 1 : 0)
}

/**
 * Returns true if only the first line of a completion should be shown.
 */
export function shouldShowOnlyFirstLine(prefix: string, suggestion: string): boolean {
  if (suggestion.startsWith("\n") || suggestion.startsWith("\r\n")) return false
  const lastNewlineIndex = prefix.lastIndexOf("\n")
  const currentLinePrefix = prefix.slice(lastNewlineIndex + 1)
  if (!currentLinePrefix.match(/\w/)) return false
  if (currentLinePrefix.trim().length > 0) return true
  return countLines(suggestion) >= 3
}

/** Extracts the first line from a completion text. */
export function getFirstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]!
}

/**
 * Apply first-line-only logic to a matching suggestion result.
 */
export function applyFirstLineOnly(
  result: MatchingSuggestionWithFillIn | null,
  prefix: string,
): MatchingSuggestionWithFillIn | null {
  if (result === null || result.text === "") return result
  if (shouldShowOnlyFirstLine(prefix, result.text)) {
    return { text: getFirstLine(result.text), matchType: result.matchType, fillInAtCursor: result.fillInAtCursor }
  }
  return result
}

/**
 * Calculate adaptive debounce delay from a latency history.
 * Clamps result between MIN_DEBOUNCE_DELAY_MS and MAX_DEBOUNCE_DELAY_MS.
 */
export function calcDebounceDelay(latencyHistory: number[]): number {
  if (latencyHistory.length === 0) return MIN_DEBOUNCE_DELAY_MS
  const sum = latencyHistory.reduce((acc, v) => acc + v, 0)
  const avg = Math.round(sum / latencyHistory.length)
  return Math.max(MIN_DEBOUNCE_DELAY_MS, Math.min(avg, MAX_DEBOUNCE_DELAY_MS))
}
