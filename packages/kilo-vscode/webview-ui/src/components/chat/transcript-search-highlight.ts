/**
 * Highlights every rendered occurrence of the current transcript search query
 * using the CSS Custom Highlight API (same technique as kilo-ui's code find
 * widget). Operates only on currently mounted DOM — virtualized rows that
 * aren't rendered yet are covered by the row-level match list in MessageList,
 * not by this highlighter.
 */

const MATCH_NAME = "kilo-transcript-search-match"
const ACTIVE_NAME = "kilo-transcript-search-match-active"

interface HighlightCtor {
  new (...ranges: Range[]): unknown
}

interface HighlightRegistry {
  set: (name: string, value: unknown) => void
  delete: (name: string) => void
}

function highlightApi(): { registry: HighlightRegistry; ctor: HighlightCtor } | undefined {
  const g = globalThis as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: HighlightCtor }
  if (!g.CSS?.highlights || typeof g.Highlight !== "function") return undefined
  return { registry: g.CSS.highlights, ctor: g.Highlight }
}

/** Builds a flat text + node-offset map for a scope so matches can span across inline elements. */
export function scanScope(scope: HTMLElement, pattern: RegExp): Range[] {
  const text = scope.textContent
  if (!text) return []

  pattern.lastIndex = 0
  const spans: { start: number; end: number }[] = []
  let match = pattern.exec(text)
  while (match) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      match = pattern.exec(text)
      continue
    }
    spans.push({ start: match.index, end: match.index + match[0].length })
    match = pattern.exec(text)
  }
  if (spans.length === 0) return []

  const nodes: Text[] = []
  const ends: number[] = []
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let pos = 0
  while (node) {
    if (node instanceof Text) {
      pos += node.data.length
      nodes.push(node)
      ends.push(pos)
    }
    node = walker.nextNode()
  }
  if (nodes.length === 0) return []

  const locate = (at: number) => {
    let lo = 0
    let hi = ends.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ends[mid]! >= at) hi = mid
      else lo = mid + 1
    }
    const prev = lo === 0 ? 0 : ends[lo - 1]!
    return { node: nodes[lo]!, offset: at - prev }
  }

  const ranges: Range[] = []
  for (const span of spans) {
    const start = locate(span.start)
    const end = locate(span.end)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    ranges.push(range)
  }
  return ranges
}

/**
 * Re-scans the currently mounted `[data-row-key]` rows under `root` and
 * re-registers highlights. Returns the resolved "current" Range (if the
 * active row is mounted) so the caller can scroll to that exact occurrence
 * instead of just the row. The occurrence index is clamped to the ranges
 * actually found in the DOM, so a data/DOM count mismatch (e.g. content the
 * renderer collapses or reformats) still always highlights *something* in
 * the active row rather than silently highlighting nothing.
 *
 * `matchedParts` maps a row key to the part ids MessageList's data model
 * could attribute a match to there. A row with **no entry** has zero
 * data-level matches, so nothing in it is scanned at all — otherwise some
 * unindexed text (a static button label, a different non-matching part in
 * the same message) could get highlighted despite never being counted. A
 * row *with* an entry (even one with an empty part-id set, e.g. an
 * error/diff row with no per-part attribution) always has SOME genuine
 * match, so scanning falls back to the whole row whenever the part-scoped
 * DOM lookup doesn't resolve to anything mounted (a part id with no
 * `[data-part-id]` marker at all — e.g. user messages — or not yet
 * expanded) — that's a lookup failure, not a signal to scan nothing.
 */
export function applyTranscriptHighlights(
  root: HTMLElement,
  pattern: RegExp | undefined,
  active: { key: string; occurrence: number } | undefined,
  matchedParts?: Map<string, Set<string>>,
): Range | undefined {
  const api = highlightApi()
  if (!api) return undefined
  api.registry.delete(MATCH_NAME)
  api.registry.delete(ACTIVE_NAME)
  if (!pattern) return undefined

  const scopes = root.querySelectorAll<HTMLElement>("[data-row-key]")
  const rest: Range[] = []
  const current: Range[] = []
  let currentRange: Range | undefined
  for (const scope of scopes) {
    // Every search scope within a row contributes to ONE combined range
    // list before the active-occurrence index is resolved — clamping it
    // per search-scope instead would treat `active.occurrence` as local to
    // whichever part happened to be scanned first, misattributing which
    // occurrence is "current" for any row with more than one contributing
    // part (e.g. a reasoning block followed by a tool call).
    const ranges = resolveSearchScopes(scope, matchedParts).flatMap((searchScope) => scanScope(searchScope, pattern))
    if (ranges.length === 0) continue
    const isActiveRow = !!active && scope.dataset.rowKey === active.key
    const activeIdx = isActiveRow ? Math.min(active!.occurrence, ranges.length - 1) : -1
    for (let i = 0; i < ranges.length; i += 1) {
      if (i === activeIdx) {
        current.push(ranges[i]!)
        currentRange = ranges[i]!
        continue
      }
      rest.push(ranges[i]!)
    }
  }
  if (rest.length > 0) api.registry.set(MATCH_NAME, new api.ctor(...rest))
  if (current.length > 0) api.registry.set(ACTIVE_NAME, new api.ctor(...current))
  return currentRange
}

/**
 * Decides which element(s) within a row to actually scan for text. A row
 * with no entry in `matchedParts` has zero data-level matches, so it's
 * skipped entirely. A row with an entry scans just its known parts' DOM
 * subtrees when they're mounted, and falls back to the whole row whenever
 * that lookup comes up empty — whether because a match couldn't be
 * attributed to a specific part at all, or because the part it WAS
 * attributed to has no `[data-part-id]` marker (or isn't mounted yet) — a
 * row with a real match should never end up scanning nothing.
 */
function resolveSearchScopes(scope: HTMLElement, matchedParts: Map<string, Set<string>> | undefined): HTMLElement[] {
  const rowKey = scope.dataset.rowKey
  const partIds = rowKey ? matchedParts?.get(rowKey) : undefined
  if (matchedParts && !partIds) return []
  const partScopes = partIds
    ? Array.from(partIds)
        .map((id) => scope.querySelector<HTMLElement>(`[data-part-id="${CSS.escape(id)}"]`))
        .filter((el): el is HTMLElement => !!el)
    : []
  return partScopes.length > 0 ? partScopes : [scope]
}

export function clearTranscriptHighlights(): void {
  const api = highlightApi()
  if (!api) return
  api.registry.delete(MATCH_NAME)
  api.registry.delete(ACTIVE_NAME)
}
