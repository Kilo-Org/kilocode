import { DateTime } from "effect"
import type { Attachment } from "@opencode/schema/prompt"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"

// The ranking below is independent of storage: callers load a bounded set of sessions and messages
// from the v2 store, and this module scores and excerpts them. It creates no database indexes.

export namespace RecallSearch {
  const MAX_QUERY = 256
  const MAX_TERMS = 12
  const MAX_SNIPPETS = 3
  const SNIPPET_CHARS = 360
  const SNIPPET_CONTEXT = 120
  const ASCII = /^[\x00-\x7f]*$/
  const WORD = /[^\p{L}\p{N}_]+/u
  const WORDCHAR = /^[\p{L}\p{N}_]$/u
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

  export type Source = "user" | "assistant" | "reference" | "error"

  export type Match = {
    source: Source
    partID: string
    text: string
  }

  export type Result = {
    id: string
    title: string
    directory: string
    updated: number
    matches: Match[]
    missing?: string[]
  }

  export type Output = {
    results: Result[]
    sessions: number
    candidates: number
    partial: boolean
  }

  /** One searchable participant of a conversation. File references and tool errors carry their own kind. */
  export type Part = {
    id: string
    kind: "text" | "file" | "tool"
    text: string
  }

  export type Message = {
    id: string
    role: "user" | "assistant" | "other"
    parts: ReadonlyArray<Part>
  }

  export type Session = {
    id: string
    title: string
    directory: string
    updated: number
    messages: ReadonlyArray<Message>
  }

  type Candidate = Match & {
    mask: number
    word: number
    phrase: boolean
  }

  type Item = Result & {
    phrase: number
    titleMask: number
    sourceMask: Record<Source, number>
    mask: number
    word: number
    fuzzy: number
    candidates: Array<Candidate | undefined>
  }

  type Query = {
    phrase: string
    terms: string[]
  }

  type Hit = {
    partID: string
    kind: "text" | "file" | "tool"
    text: string
    role: "user" | "assistant" | "other"
    mask: number
    word: number
    phrase: boolean
  }

  export type Accumulator = {
    add: (session: Session) => void
    finish: () => Output
  }

  /**
   * Build the ranking state for one query. Callers add sessions as they load, so a search never holds the
   * whole project history in memory at once.
   */
  export function create(input: {
    query: string
    limit?: number
    signal?: AbortSignal
    excludeSessionID?: string
    excludeFromMessageID?: string
  }): Accumulator {
    const parsed = parse(input.query)
    const full = (1 << parsed.terms.length) - 1
    const limit = input.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search result limits must be integers from 1 to 50")
    }
    const items = new Map<string, Item>()
    let candidates = 0

    return {
      add(session) {
        abort(input.signal)
        const title = session.id === input.excludeSessionID ? "" : fold(session.title)
        const titleMask = mask(title, parsed.terms)
        const fuzzy = titleMask === full ? 0 : approximate(title, parsed.terms, titleMask)
        const item: Item = {
          id: session.id,
          title: session.title,
          directory: session.directory,
          updated: session.updated,
          matches: [],
          phrase: title.includes(parsed.phrase) ? 5 : 0,
          titleMask,
          sourceMask: { user: 0, assistant: 0, reference: 0, error: 0 },
          mask: titleMask | fuzzy,
          word: words(title, parsed.terms, titleMask),
          fuzzy,
          candidates: Array.from({ length: parsed.terms.length }),
        }
        items.set(session.id, item)
        const excluded =
          session.id === input.excludeSessionID
            ? (messageID: string) => messageID >= (input.excludeFromMessageID ?? "")
            : () => false

        for (const message of session.messages) {
          if (message.role === "other" || excluded(message.id)) continue
          for (const part of message.parts) {
            if (!part.text) continue
            const normalized = fold(part.text)
            const matched = mask(normalized, parsed.terms)
            if (matched === 0 && ASCII.test(part.text)) continue
            candidates++
            if (matched === 0) continue
            const hit: Hit = {
              partID: part.id,
              kind: part.kind,
              text: part.text,
              role: message.role,
              mask: matched,
              word: words(normalized, parsed.terms, matched),
              phrase: normalized.includes(parsed.phrase),
            }
            if (hit.kind === "text") {
              if (hit.role !== "user" && hit.role !== "assistant") continue
              consume(item, hit, hit.role, parsed)
              continue
            }
            consume(item, hit, hit.kind === "file" ? "reference" : "error", parsed)
          }
        }
      },
      finish() {
        if (items.size === 0) return { results: [], sessions: 0, candidates: 0, partial: false }
        const best = rank(items.values(), full, limit, (item) => item.mask === full)
        // Fall back to the sessions covering the most terms when no session contains every term.
        const partial =
          best.length === 0 && parsed.terms.length > 1
            ? rank(items.values(), full, limit, (item) => bits(item.mask) * 2 >= parsed.terms.length)
            : []
        for (const item of partial) {
          item.missing = parsed.terms.filter((_, index) => (item.mask & (1 << index)) === 0)
        }
        return {
          results: (partial.length ? partial : best).map(
            ({
              phrase: _phrase,
              titleMask: _title,
              sourceMask: _source,
              mask: _mask,
              word: _word,
              fuzzy: _fuzzy,
              candidates: _candidates,
              ...item
            }) => item,
          ),
          sessions: items.size,
          candidates,
          partial: partial.length > 0,
        }
      },
    }
  }

  export function search(input: {
    query: string
    sessions: ReadonlyArray<Session>
    limit?: number
    signal?: AbortSignal
    excludeSessionID?: string
    excludeFromMessageID?: string
  }): Output {
    const accumulator = create(input)
    for (const session of input.sessions) accumulator.add(session)
    return accumulator.finish()
  }

  /** Escape historical text so it cannot act as markup in the tool result. */
  export function inert(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  }

  /** The user message that opened the turn containing `messageID`, or `messageID` when there is none. */
  export function active(messages: ReadonlyArray<SessionMessage.MediaInfo>, messageID: string) {
    return messages.findLast((message) => message.type === "user" && message.id < messageID)?.id ?? messageID
  }

  /** The messages before the active turn, oldest first. */
  export function visible(messages: ReadonlyArray<SessionMessage.MediaInfo>, messageID: string) {
    return messages.filter((message) => message.id < messageID)
  }

  /** Convert one stored session into searchable parts, excluding synthetic, reasoning and successful tool output. */
  export function toSearchSession(
    session: Session.Info,
    messages: ReadonlyArray<SessionMessage.MediaInfo>,
  ): Session {
    return {
      id: session.id,
      title: session.title ?? session.id,
      directory: session.location.directory,
      updated: DateTime.toEpochMillis(session.time.updated),
      messages: messages.map((message) => ({
        id: message.id,
        role: roleOf(message),
        parts: partsOf(message),
      })),
    }
  }

  function roleOf(message: SessionMessage.MediaInfo): Message["role"] {
    if (message.type === "user") return "user"
    if (message.type === "assistant") return "assistant"
    return "other"
  }

  function partsOf(message: SessionMessage.MediaInfo): Part[] {
    if (message.type === "user") {
      const files: Part[] = (message.files ?? []).flatMap((file, index) => {
        const text = fileText(file)
        return text ? [{ id: `${message.id}:file:${index}`, kind: "file" as const, text }] : []
      })
      return [
        { id: `${message.id}:text`, kind: "text", text: message.text },
        ...files,
      ]
    }
    if (message.type !== "assistant") return []
    return message.content.flatMap((part, index): Part[] => {
      if (part.type === "text") return [{ id: `${message.id}:${index}`, kind: "text", text: part.text }]
      if (part.type !== "tool" || part.state.status !== "error") return []
      return [{ id: `${message.id}:${index}`, kind: "tool", text: part.state.error.message }]
    })
  }

  function fileText(file: Attachment): string {
    const uri = file.source.type === "uri" && !file.source.uri.startsWith("data:") ? file.source.uri : undefined
    return [file.name, uri, file.description, file.mention?.text].filter(Boolean).join(" ")
  }

  function rank(items: Iterable<Item>, full: number, limit: number, accept: (item: Item) => boolean) {
    const best: Item[] = []
    for (const item of items) {
      if (item.mask === 0 || !accept(item)) continue
      item.matches = snippets(item, full & item.mask)
      best.push(item)
      best.sort(compare)
      if (best.length > limit) best.pop()
    }
    return best
  }

  function parse(query: string) {
    const value = query.trim()
    if (!value) throw new Error("The 'query' parameter is required when mode is 'search'")
    if (value.length > MAX_QUERY) throw new Error(`Search queries cannot exceed ${MAX_QUERY} characters`)
    const phrase = fold(value).replace(/\s+/g, " ")
    const terms = [...new Set(phrase.split(" ").filter(Boolean))]
    if (terms.length > MAX_TERMS) throw new Error(`Search queries cannot exceed ${MAX_TERMS} terms`)
    return { phrase, terms } satisfies Query
  }

  function fold(value: string) {
    return (ASCII.test(value) ? value : value.normalize("NFKC")).toLowerCase()
  }

  function mask(value: string, terms: string[]) {
    return terms.reduce((result, term, index) => result | (value.includes(term) ? 1 << index : 0), 0)
  }

  // Bits of `matched` whose term also occurs as a whole word.
  function words(value: string, terms: string[], matched: number) {
    return terms.reduce(
      (result, term, index) => result | ((matched & (1 << index)) !== 0 && whole(value, term) >= 0 ? 1 << index : 0),
      0,
    )
  }

  // Index of the first occurrence of `term` that is not glued to letters, digits, or underscores, or -1.
  function whole(value: string, term: string) {
    for (let index = value.indexOf(term); index >= 0; index = value.indexOf(term, index + 1)) {
      if (!wordy(value, index - 1, true) && !wordy(value, index + term.length, false)) return index
    }
    return -1
  }

  function wordy(value: string, index: number, before: boolean) {
    if (index < 0 || index >= value.length) return false
    const code = value.charCodeAt(index)
    const start = before && code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
    return WORDCHAR.test(String.fromCodePoint(value.codePointAt(start) ?? 0))
  }

  // Bits of terms that are absent from the title but within a small edit distance of one of its words.
  function approximate(title: string, terms: string[], matched: number) {
    if (!title) return 0
    const parts = title.split(WORD).filter(Boolean)
    return terms.reduce((result, term, index) => {
      if ((matched & (1 << index)) !== 0) return result
      const budget = term.length >= 8 ? 2 : term.length >= 5 ? 1 : 0
      if (budget === 0) return result
      return parts.some(
        (part) => Math.abs(part.length - term.length) <= budget && distance(part, term, budget) <= budget,
      )
        ? result | (1 << index)
        : result
    }, 0)
  }

  // Optimal string alignment distance, capped at `limit + 1`.
  function distance(a: string, b: string, limit: number) {
    let previous2: number[] = []
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 1; i <= a.length; i++) {
      const current = [i]
      let low = i
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
        const value = Math.min(
          previous[j]! + 1,
          current[j - 1]! + 1,
          previous[j - 1]! + cost,
          swap ? previous2[j - 2]! + 1 : Infinity,
        )
        current.push(value)
        low = Math.min(low, value)
      }
      if (low > limit) return limit + 1
      previous2 = previous
      previous = current
    }
    return previous[b.length]!
  }

  function bits(value: number) {
    let count = 0
    for (let mask = value; mask > 0; mask >>>= 1) count += mask & 1
    return count
  }

  function weight(source: Source) {
    if (source === "user") return 4
    if (source === "assistant") return 3
    if (source === "reference") return 2
    return 1
  }

  function consume(item: Item, hit: Omit<Hit, "role">, source: Source, query: Query) {
    item.mask |= hit.mask
    item.word |= hit.word
    item.sourceMask[source] |= hit.mask
    item.phrase = Math.max(item.phrase, hit.phrase ? weight(source) : 0)
    candidate(
      item.candidates,
      {
        source,
        partID: hit.partID,
        mask: hit.mask,
        word: hit.word,
        phrase: hit.phrase,
      },
      () => excerpt(hit.text, query),
    )
  }

  function candidate(items: Array<Candidate | undefined>, item: Omit<Candidate, "text">, text: () => string) {
    const indexes: number[] = []
    for (let index = 0; index < items.length; index++) {
      if ((item.mask & (1 << index)) === 0) continue
      const current = items[index]
      if (current && compareCandidate(current, item) <= 0) continue
      indexes.push(index)
    }
    if (indexes.length === 0) return
    const next = { ...item, text: text() }
    for (const index of indexes) items[index] = next
  }

  function compareCandidate(a: Omit<Candidate, "text">, b: Omit<Candidate, "text">) {
    if (a.phrase !== b.phrase) return Number(b.phrase) - Number(a.phrase)
    if (bits(a.word) !== bits(b.word)) return bits(b.word) - bits(a.word)
    if (weight(a.source) !== weight(b.source)) return weight(b.source) - weight(a.source)
    if (bits(a.mask) !== bits(b.mask)) return bits(b.mask) - bits(a.mask)
    return a.partID.localeCompare(b.partID)
  }

  function snippets(item: Item, full: number) {
    const candidates = [...new Set(item.candidates.filter((value) => value !== undefined))]
    const result: Match[] = []
    let missing = full & ~item.titleMask & ~item.fuzzy
    while (result.length < MAX_SNIPPETS && missing !== 0) {
      candidates.sort((a, b) => bits(b.mask & missing) - bits(a.mask & missing) || compareCandidate(a, b))
      const value = candidates.shift()
      if (!value || (value.mask & missing) === 0) break
      result.push({ source: value.source, partID: value.partID, text: value.text })
      missing &= ~value.mask
    }
    if (result.length === 0 && candidates[0]) {
      const value = candidates.sort(compareCandidate)[0]
      result.push({ source: value.source, partID: value.partID, text: value.text })
    }
    return result
  }

  function compare(a: Item, b: Item) {
    if (bits(a.mask) !== bits(b.mask)) return bits(b.mask) - bits(a.mask)
    if (a.phrase > 0 !== b.phrase > 0) return Number(b.phrase > 0) - Number(a.phrase > 0)
    if (bits(a.fuzzy) !== bits(b.fuzzy)) return bits(a.fuzzy) - bits(b.fuzzy)
    if (bits(a.word) !== bits(b.word)) return bits(b.word) - bits(a.word)
    if (a.phrase !== b.phrase) return b.phrase - a.phrase
    if (bits(a.titleMask) !== bits(b.titleMask)) return bits(b.titleMask) - bits(a.titleMask)
    for (const source of ["user", "assistant", "reference", "error"] as const) {
      if (bits(a.sourceMask[source]) !== bits(b.sourceMask[source])) {
        return bits(b.sourceMask[source]) - bits(a.sourceMask[source])
      }
    }
    if (a.updated !== b.updated) return b.updated - a.updated
    return a.id.localeCompare(b.id)
  }

  function excerpt(text: string, query: Query) {
    const raw = text.toLowerCase()
    const direct = anchor(raw, query) ?? -1
    const ascii = direct >= 0 && !/[^\x00-\x7F]/.test(text.slice(0, direct))
    const position = ascii ? direct : locate(text, query)
    const start = Math.max(0, position - SNIPPET_CONTEXT)
    const value = text.slice(start, start + SNIPPET_CHARS).trim()
    return `${start > 0 ? "..." : ""}${value}${start + SNIPPET_CHARS < text.length ? "..." : ""}`
  }

  // Position to centre the snippet on: a multi-term phrase, else the earliest whole-word term, else the earliest term.
  function anchor(value: string, query: Query) {
    const phrase = value.indexOf(query.phrase)
    if (phrase >= 0 && query.terms.length > 1) return phrase
    const bounded = query.terms.map((term) => whole(value, term)).filter((position) => position >= 0)
    if (bounded.length) return Math.min(...bounded)
    if (phrase >= 0) return phrase
    const positions = query.terms.map((term) => value.indexOf(term)).filter((position) => position >= 0)
    return positions.length ? Math.min(...positions) : undefined
  }

  function locate(text: string, query: Query) {
    const normalized = fold(text)
    const target = anchor(normalized, query) ?? 0
    let offset = 0
    for (const item of segmenter.segment(text)) {
      offset += fold(item.segment).length
      if (offset > target) return item.index
    }
    return 0
  }

  function abort(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Recall search aborted")
  }
}
