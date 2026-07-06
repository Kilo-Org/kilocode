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

function locate(text: string, ref: Ref, index: number): Ref | undefined {
  const source = ref.source
  if (!source.value) return undefined

  if (Number.isFinite(source.start) && Number.isFinite(source.end)) {
    const start = Math.min(text.length, Math.max(0, source.start))
    const end = Math.min(text.length, Math.max(0, source.end))
    if (start >= index && start <= end && text.slice(start, end) === source.value) {
      return { ...ref, source: { ...source, start, end } }
    }
  }

  const hint = Number.isFinite(source.start) ? Math.min(text.length, Math.max(index, source.start)) : index
  const found = text.indexOf(source.value, hint)
  const start = found === -1 ? text.indexOf(source.value, index) : found
  if (start === -1) return undefined
  return { ...ref, source: { ...source, start, end: start + source.value.length } }
}

/**
 * Find every position at or after `from` where `value` occurs as a complete,
 * boundary-delimited token (flanked by whitespace or a string edge on both
 * sides). A plain substring search would let a shorter mention match as a
 * prefix of a longer, distinct one that starts the same way (e.g. "@a.ts"
 * inside "@a.tsx"), truncating the real mention's highlight.
 */
function repeats(text: string, value: string, from: number): number[] {
  const result: number[] = []
  let search = from

  while (true) {
    const found = text.indexOf(value, search)
    if (found === -1) break

    const end = found + value.length
    const before = found === 0 || /\s/.test(text[found - 1] ?? "")
    const after = end === text.length || /\s/.test(text[end] ?? "")
    if (before && after) result.push(found)
    search = found + 1
  }

  return result
}

function resolve(text: string, refs: Ref[]): Ref[] {
  const result: Ref[] = []
  let index = 0

  for (const ref of [...refs].sort((a, b) => a.source.start - b.source.start || b.source.end - a.source.end)) {
    const next = locate(text, ref, index)
    if (!next) continue

    result.push(next)
    index = next.source.end

    // mentionedPaths is a Set, so a path mentioned more than once in the same
    // message only produces a single attachment/ref. Highlight any later
    // boundary-delimited repeats of this ref's mention text too, so every
    // occurrence stays highlighted, not just the first.
    for (const start of repeats(text, next.source.value, index)) {
      const end = start + next.source.value.length
      result.push({ ...next, source: { ...next.source, start, end } })
      index = Math.max(index, end)
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
