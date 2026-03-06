// Fuzzy search utility for the model picker.
//
// Enhances fuzzysort with multi-word tokenized matching and edit-distance
// fallback so that typos, transpositions, and out-of-order terms still
// produce ranked results (e.g. "claud sont" or "cluade" → "Claude Sonnet 4").

import * as fuzzysort from "fuzzysort"

// Weight applied to title matches vs category matches.
const TITLE_WEIGHT = 2
const CATEGORY_WEIGHT = 1

// Maximum edit distance we compute (limits O(n*m) cost on long strings).
const MAX_EDIT_DISTANCE = 3

interface Searchable {
  title: string
  category?: string
}

interface ScoredResult<T extends Searchable> {
  obj: T
  score: number
}

// Compute bounded Levenshtein distance between two strings.
// Returns Infinity when distance exceeds `max` (early exit).
function editDistance(a: string, b: string, max: number): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > max) return Infinity

  // Use single-row DP with O(min(m,n)) space
  const shorter = m < n ? a : b
  const longer = m < n ? b : a
  const sLen = shorter.length
  const lLen = longer.length

  const row = new Uint16Array(sLen + 1)
  for (let i = 0; i <= sLen; i++) row[i] = i

  for (let i = 1; i <= lLen; i++) {
    let prev = row[0]!
    row[0] = i
    let min = row[0]!
    for (let j = 1; j <= sLen; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1
      const val = Math.min(
        row[j]! + 1, // deletion
        row[j - 1]! + 1, // insertion
        prev + cost, // substitution
      )
      prev = row[j]!
      row[j] = val
      if (val < min) min = val
    }
    // Early exit when even the best cell in this row exceeds max
    if (min > max) return Infinity
  }

  return row[sLen]!
}

// Maximum allowed edit distance scales with term length:
//   1-3 chars → 1 edit, 4-6 chars → 2 edits, 7+ chars → 3 edits
function maxEdits(length: number): number {
  if (length <= 3) return 1
  if (length <= 6) return 2
  return 3
}

// Normalize edit distance to a 0-1 score where 1 is a perfect match.
// Rejects matches that exceed the length-proportional max edits.
function editScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Prefix match bonus: if the target starts with the query, score highly
  if (t.startsWith(q)) return 0.95

  const allowed = maxEdits(q.length)
  const dist = editDistance(q, t, Math.min(allowed, MAX_EDIT_DISTANCE))
  if (dist === Infinity) return 0
  if (dist > allowed) return 0
  const maxLen = Math.max(q.length, t.length)
  if (maxLen === 0) return 1
  return Math.max(0, 1 - dist / maxLen)
}

// Score a single query term against a target string.
// Returns a value in [0, 1] where 1 is a perfect match.
// Uses word-level edit distance to match terms like "hiku" → "Haiku".
function termScore(term: string, target: string): number {
  // Try edit distance against individual words in the target
  // so "hiku" matches the "Haiku" word in "Claude Haiku 3.5".
  const words = target.split(/[\s\-_.]+/)
  let best = 0
  for (const word of words) {
    const s = editScore(term, word)
    if (s > best) best = s
  }

  // Also try substring containment (case-insensitive) — if the query term
  // appears verbatim inside the target, it's a strong signal.
  if (target.toLowerCase().includes(term.toLowerCase())) {
    const containScore = 0.9 * (term.length / target.length) + 0.1
    if (containScore > best) best = containScore
  }

  return best
}

// Score an item by matching each query term against both title and category.
// Each term contributes its best weighted score.  Final score is the geometric
// mean of per-term scores so that a single bad term drags the score down
// rather than being hidden by other good terms.
function scoreItem<T extends Searchable>(terms: string[], item: T): number {
  if (terms.length === 0) return 0

  let product = 1
  for (const term of terms) {
    const ts = termScore(term, item.title) * TITLE_WEIGHT
    const cs = item.category ? termScore(term, item.category) * CATEGORY_WEIGHT : 0
    const best = Math.max(ts, cs)
    if (best <= 0) return 0 // every term must match something
    product *= best
  }

  return Math.pow(product, 1 / terms.length)
}

// Minimum score for edit-distance fallback results to be included.
const FALLBACK_THRESHOLD = 0.3

// Primary search entry point.  Splits the query into whitespace-separated
// terms and scores each item independently, returning results sorted by
// descending score.
//
// For single-word queries this delegates directly to fuzzysort (which has
// highly optimised single-string matching) and only uses the edit-distance
// fallback when fuzzysort returns no results.
export function search<T extends Searchable>(query: string, items: T[]): T[] {
  const needle = query.trim()
  if (!needle) return items

  const terms = needle.split(/\s+/).filter(Boolean)

  // Fast path: single term — try fuzzysort first for speed, fall back to
  // our enhanced scoring only when fuzzysort misses.
  if (terms.length === 1) {
    const fzf = fuzzysort
      .go(needle, items, {
        keys: ["title", "category"] as const,
        scoreFn: (r) => r[0].score * TITLE_WEIGHT + r[1].score * CATEGORY_WEIGHT,
      })
      .map((r) => ({ obj: r.obj, score: r.score }))

    if (fzf.length > 0) return fzf.map((r) => r.obj)

    // Edit-distance fallback for typos fuzzysort can't handle
    return fallbackSearch(terms, items)
  }

  // Multi-term: score every item with per-term matching. This naturally
  // handles out-of-order terms (each term is matched independently).
  // We also run fuzzysort on the full query to capture cases where the
  // concatenated query matches well as a single string.
  const scored: ScoredResult<T>[] = []
  const fzfResults = fuzzysort.go(needle, items, {
    keys: ["title", "category"] as const,
    scoreFn: (r) => r[0].score * TITLE_WEIGHT + r[1].score * CATEGORY_WEIGHT,
  })
  const fzfScores = new Map(fzfResults.map((r) => [r.obj, r.score]))

  for (const item of items) {
    const termBasedScore = scoreItem(terms, item)
    const fzfScore = fzfScores.get(item) ?? 0
    // Take the better of the two scores
    const combined = Math.max(termBasedScore, fzfScore)
    if (combined > FALLBACK_THRESHOLD) {
      scored.push({ obj: item, score: combined })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((r) => r.obj)
}

// Fallback for single-term queries where fuzzysort returned nothing.
function fallbackSearch<T extends Searchable>(terms: string[], items: T[]): T[] {
  const scored: ScoredResult<T>[] = []
  for (const item of items) {
    const s = scoreItem(terms, item)
    if (s > FALLBACK_THRESHOLD) {
      scored.push({ obj: item, score: s })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((r) => r.obj)
}
