/**
 * Word-boundary matching for model/provider search.
 *
 * Splits text at camelCase transitions and common delimiters so that e.g.
 * "clso" matches "Claude Sonnet" (Cl + So) and "gpt5" matches "gpt-5".
 * Multi-word queries like "claude sonnet" require every fragment to match
 * independently.
 *
 * Ported from legacy word-boundary-fzf.ts.
 */

// Split at positions before uppercase letters (camelCase/PascalCase)
// and at common delimiters: hyphen, underscore, dot, colon, whitespace,
// forward/back slash, brackets, parentheses.
const WORD_BOUNDARY = /(?=[A-Z])|[[\]_.:\s/\\(){}-]+/

/**
 * Match a single query fragment against text using word-boundary acronym
 * matching.  Each character in `query` must match the start of a word in
 * `text`, consuming consecutive characters from the same word before moving
 * to the next.
 *
 * Examples:
 * - acronymMatch("Claude Sonnet", "clso") → true  (Cl + So)
 * - acronymMatch("gitRebase", "gr") → true  (git + Rebase)
 * - acronymMatch("faoboc", "foo") → false  (no word boundary)
 */
export function acronymMatch(text: string, query: string): boolean {
  const words = text
    .split(WORD_BOUNDARY)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase())

  const attempt = (wi: number, qi: number): boolean => {
    if (qi === query.length) return true
    if (wi >= words.length) return false
    const word = words[wi]!
    let consumed = 0
    while (qi + consumed < query.length && consumed < word.length && word[consumed] === query[qi + consumed]) consumed++
    if (consumed > 0 && attempt(wi + 1, qi + consumed)) return true
    return attempt(wi + 1, qi)
  }

  return attempt(0, 0)
}

/**
 * High-level search: trims and lowercases the query, splits multi-word
 * queries at word boundaries, and requires every fragment to match.
 *
 * Returns `true` when `query` is empty/whitespace-only.
 */
export function searchMatch(query: string, text: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const parts = q.split(WORD_BOUNDARY).filter((w) => w.length > 0)
  if (parts.length === 0) return true
  return parts.every((p) => acronymMatch(text, p))
}
