export type HighlightSegment = { text: string; type?: "file" | "agent" }

type Source = {
  value: string
  start: number
  end: number
}

type FileRef = {
  source?: Record<string, unknown> & {
    text?: Source
  }
}

type AgentRef = {
  source?: Source
}

type Ref = {
  source: Source
  type: "file" | "agent"
}

/**
 * Match @path mentions: `@` followed by a path-like token (contains `/` or `.`).
 * This regex is the fallback used only when no source position data is available
 * (e.g. messages sent before file attachments carried source.text). It intentionally
 * does not match spaces: a pattern permissive enough to span space-separated path
 * segments also matches ordinary prose following any @mention (e.g. `@agent check
 * the report for v1.2 details` would swallow everything up to `v1.2`). Paths with
 * spaces are highlighted correctly via the source.text-based resolve() path instead,
 * which locates the exact known mention text rather than pattern-matching prose.
 */
const MENTION_RE = /@([\w./-]+\.[\w]+|[\w.-]+\/[\w./-]+)/g

function detect(text: string): Ref[] {
  return Array.from(text.matchAll(MENTION_RE), (match) => ({
    source: { value: match[0] ?? "", start: match.index, end: match.index + match[0].length },
    type: "file" as const,
  }))
}

function locate(text: string, ref: Ref, claimed: { start: number; end: number }[]): Ref | undefined {
  const source = ref.source
  if (!source.value) return undefined

  const free = (start: number, end: number) => !claimed.some((c) => start < c.end && end > c.start)

  if (Number.isFinite(source.start) && Number.isFinite(source.end)) {
    const start = Math.min(text.length, Math.max(0, source.start))
    const end = Math.min(text.length, Math.max(0, source.end))
    if (text.slice(start, end) === source.value && free(start, end)) {
      return { ...ref, source: { ...source, start, end } }
    }
  }

  const firstFree = (from: number) => {
    let search = from
    while (true) {
      const found = text.indexOf(source.value, search)
      if (found === -1) return undefined
      const end = found + source.value.length
      if (free(found, end)) return { start: found, end }
      search = found + 1
    }
  }

  // Prefer the first unclaimed occurrence at or after this ref's own recorded
  // position, falling back to the first unclaimed occurrence anywhere. Each
  // ref is searched against its own hint rather than a cursor shared across
  // every other ref, so locating one ref can't skip past a distinct ref's real
  // occurrence that sits between two repeats of an earlier one (see the
  // interleaved-mentions regression test).
  const hint = Number.isFinite(source.start) ? Math.min(text.length, Math.max(0, source.start)) : 0
  const match = firstFree(hint) ?? firstFree(0)
  if (!match) return undefined
  return { ...ref, source: { ...source, start: match.start, end: match.end } }
}

// Any letter, digit, underscore, slash, or hyphen unambiguously continues a
// path token. Uses Unicode property escapes rather than \w, which matches
// ASCII letters/digits only in JavaScript regex — without this, a Cyrillic
// or CJK mention (e.g. "@файл") would not be recognized as continuing into a
// longer, distinct mention that starts the same way (e.g. "@файлы"),
// reintroducing the same collision this check exists to prevent. A dot is
// handled separately (see continuesPath) since it is both a common
// sentence-ending character and a path/extension separator.
const PATH_CONTINUATION = /[\p{L}\p{N}_/-]/u

/**
 * Whether `text[end]` extends a match into a longer, different path rather
 * than ending it. A dot only counts as a continuation when another
 * letter/digit follows (e.g. "@report.csv" + ".bak", or the "x" in "@a.tsx"
 * itself is already caught by PATH_CONTINUATION) — a lone trailing dot, as
 * in an ordinary sentence ending, does not.
 */
function continuesPath(text: string, end: number): boolean {
  const char = text[end]
  if (char === undefined) return false
  if (PATH_CONTINUATION.test(char)) return true
  return char === "." && /[\p{L}\p{N}_]/u.test(text[end + 1] ?? "")
}

/**
 * Find every position at or after `from` where `value` occurs as a complete
 * token, not immediately preceded by a character that could extend it into a
 * longer, different path, and not immediately claimed by `others` — the exact
 * mention text of every other known ref. A plain substring search would let a
 * shorter mention match as a prefix of a longer, distinct one that starts the
 * same way (e.g. "@a.ts" inside "@a.tsx", or "@a.txt" inside the space-containing
 * "@a.txt backup.txt"). Checking against the other refs' actual mention text,
 * rather than only a generic continuation-character heuristic, is required
 * because a space can no longer be assumed to end a mention now that paths may
 * contain spaces — `continuesPath` alone would treat the boundary before
 * "backup.txt" as valid. Ordinary punctuation such as a trailing comma,
 * sentence-ending period, or closing paren is not a continuation character,
 * so a repeat directly followed by it is still accepted.
 */
function repeats(text: string, value: string, others: string[], claimed: { start: number; end: number }[]): number[] {
  const result: number[] = []
  let search = 0

  while (true) {
    const found = text.indexOf(value, search)
    if (found === -1) break

    const end = found + value.length
    const before = found === 0 || !PATH_CONTINUATION.test(text[found - 1] ?? "")
    const after = !continuesPath(text, end)
    const collides = others.some((other) => other !== value && other.length > value.length && text.startsWith(other, found))
    const free = !claimed.some((c) => found < c.end && end > c.start)
    if (before && after && !collides && free) result.push(found)
    search = found + 1
  }

  return result
}

function resolve(text: string, refs: Ref[]): Ref[] {
  const others = refs.map((ref) => ref.source.value)
  const claimed: { start: number; end: number }[] = []
  const result: Ref[] = []

  // Locate each ref's own primary occurrence first, independently of every
  // other ref, so a distinct ref's real occurrence sitting between two
  // repeats of an earlier one is never skipped over (see the
  // interleaved-mentions regression test).
  for (const ref of [...refs].sort((a, b) => a.source.start - b.source.start || b.source.end - a.source.end)) {
    const next = locate(text, ref, claimed)
    if (!next) continue
    result.push(next)
    claimed.push({ start: next.source.start, end: next.source.end })
  }

  // mentionedPaths is a Set, so a path mentioned more than once in the same
  // message only produces a single attachment/ref. Highlight any later
  // boundary-delimited repeats of each located ref's mention text too, so
  // every occurrence stays highlighted, not just the first.
  for (const ref of [...result]) {
    for (const start of repeats(text, ref.source.value, others, claimed)) {
      const end = start + ref.source.value.length
      result.push({ ...ref, source: { ...ref.source, start, end } })
      claimed.push({ start, end })
    }
  }

  return result
}

export function buildHighlightedTextSegments(text: string, files: FileRef[], agents: AgentRef[]): HighlightSegment[] {
  const refs = [
    ...files
      .map((file) => file.source?.text)
      .filter((source): source is Source => source?.start !== undefined && source.end !== undefined)
      .map((source) => ({ source, type: "file" as const })),
    ...agents
      .map((agent) => agent.source)
      .filter((source): source is Source => source?.start !== undefined && source.end !== undefined)
      .map((source) => ({ source, type: "agent" as const })),
  ]

  const ranges = (refs.length > 0 ? resolve(text, refs) : detect(text)).sort(
    (a, b) => a.source.start - b.source.start || b.source.end - a.source.end,
  )

  const result: HighlightSegment[] = []
  let index = 0

  for (const ref of ranges) {
    if (ref.source.start < index) continue

    if (ref.source.start > index) {
      result.push({ text: text.slice(index, ref.source.start) })
    }

    result.push({ text: text.slice(ref.source.start, ref.source.end), type: ref.type })
    index = ref.source.end
  }

  if (index < text.length) {
    result.push({ text: text.slice(index) })
  }

  return result
}
