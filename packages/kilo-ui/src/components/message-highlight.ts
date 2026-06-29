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

/** Match @path mentions: `@` followed by a path-like token (contains `/` or `.`). */
const MENTION_RE = /@([\w./-]+\.[\w]+|[\w.-]+\/[\w./-]+)/g

function detect(text: string): Ref[] {
  return Array.from(text.matchAll(MENTION_RE), (match) => ({
    source: { value: match[0] ?? "", start: match.index, end: match.index + match[0].length },
    type: "file" as const,
  }))
}

function resolve(text: string, ref: Ref): Ref | undefined {
  const source = ref.source
  if (!source.value) return undefined

  if (Number.isFinite(source.start) && Number.isFinite(source.end)) {
    const start = Math.max(0, source.start)
    const end = Math.min(text.length, source.end)
    if (start <= end && text.slice(start, end) === source.value) {
      return { ...ref, source: { ...source, start, end } }
    }
  }

  const start = text.indexOf(source.value)
  if (start === -1) return undefined
  return { ...ref, source: { ...source, start, end: start + source.value.length } }
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

  const ranges = (
    refs.length > 0 ? refs.map((ref) => resolve(text, ref)).filter((ref): ref is Ref => !!ref) : detect(text)
  ).sort((a, b) => a.source.start - b.source.start || b.source.end - a.source.end)

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
