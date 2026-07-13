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
 */
export function applyTranscriptHighlights(
  root: HTMLElement,
  pattern: RegExp | undefined,
  active: { key: string; occurrence: number } | undefined,
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
    const ranges = scanScope(scope, pattern)
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

export function clearTranscriptHighlights(): void {
  const api = highlightApi()
  if (!api) return
  api.registry.delete(MATCH_NAME)
  api.registry.delete(ACTIVE_NAME)
}
