import path from "path"
import { eq, inArray, sql } from "drizzle-orm"
import { Cause, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { RecallPartIndex } from "@opencode-ai/core/kilocode/session/recall-part-index"
import { RecallMessageIndex } from "@opencode-ai/core/kilocode/session/recall-message-index"
import type { MessageV2 } from "@/session/message-v2"
import { SessionTable } from "@opencode-ai/core/session/sql"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"

export namespace RecallSearch {
  const BATCH = 8_192
  const PAGE_SIZE = 1_024
  const MAX_QUERY = 256
  const MAX_TERMS = 12
  const MAX_SNIPPETS = 3
  const SNIPPET_CHARS = 360
  const SNIPPET_CONTEXT = 120
  const ASCII = /^[\x00-\x7f]*$/
  const WORD = /[^\p{L}\p{N}_]+/u
  const WORDCHAR = /^[\p{L}\p{N}_]$/u
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
  const ready = new WeakSet<object>()
  const degraded = new WeakSet<object>()

  const TEXT_SQL = `CASE
      WHEN json_extract(p.data, '$.type') = 'text' THEN coalesce(json_extract(p.data, '$.text'), '')
      WHEN json_extract(p.data, '$.type') = 'file' THEN trim(
        coalesce(json_extract(p.data, '$.filename'), '') || ' ' ||
        CASE WHEN coalesce(json_extract(p.data, '$.url'), '') NOT LIKE 'data:%'
          THEN coalesce(json_extract(p.data, '$.url'), '') ELSE '' END || ' ' ||
        coalesce(json_extract(p.data, '$.source.path'), '') || ' ' ||
        coalesce(json_extract(p.data, '$.source.name'), '') || ' ' ||
        CASE WHEN coalesce(json_extract(p.data, '$.source.uri'), '') NOT LIKE 'data:%'
          THEN coalesce(json_extract(p.data, '$.source.uri'), '') ELSE '' END || ' ' ||
        coalesce(json_extract(p.data, '$.source.clientName'), '')
      )
      ELSE coalesce(json_extract(p.data, '$.state.error'), '')
    END`

  const PART_FILTER_SQL = `
    json_valid(p.data) AND (
      (json_extract(p.data, '$.type') = 'text'
        AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
        AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0)
      OR json_extract(p.data, '$.type') = 'file'
      OR (json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state.status') = 'error')
    )`

  export const query = (
    ids: SessionID[],
    terms: string[],
    cursor: { sessionID: SessionID | ""; partID: PartID | "" },
  ) => sql`
    SELECT
      p.id AS partID,
      p.message_id AS messageID,
      p.session_id AS sessionID,
      json_extract(p.data, '$.type') AS kind,
      ${sql.raw(TEXT_SQL)} AS text
    FROM part AS p
    WHERE p.session_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
      AND (p.session_id > ${cursor.sessionID} OR (p.session_id = ${cursor.sessionID} AND p.id > ${cursor.partID}))
      AND (${sql.raw(PART_FILTER_SQL)})
      AND (
        ${sql.join(
          terms.map((term) => sql`instr(lower(${sql.raw(TEXT_SQL)}), ${term}) > 0`),
          sql` OR `,
        )}
        OR length(${sql.raw(TEXT_SQL)}) <> length(CAST(${sql.raw(TEXT_SQL)} AS BLOB))
      )
    ORDER BY p.session_id, p.id
    LIMIT ${PAGE_SIZE}`

  const ensure = (db: Database.Interface["db"]) =>
    Effect.gen(function* () {
      if (ready.has(db)) return true
      return yield* db.run(sql.raw(RecallPartIndex.createSql)).pipe(
        Effect.andThen(db.run(sql.raw(RecallMessageIndex.createSql))),
        Effect.andThen(Effect.sync(() => ready.add(db))),
        Effect.as(true),
        Effect.catch((error) => Effect.logWarning("recall index unavailable", { error }).pipe(Effect.as(false))),
      )
    })

  // SQLite prefers the unique primary key index for id lookups, so the covering index must be requested.
  export const messages = (ids: MessageID[], indexed: boolean) => sql`
    SELECT
      id,
      json_extract(data, '$.role') AS role,
      coalesce(json_extract(data, '$.parentID'), '') AS parentID
    FROM message ${indexed ? sql.raw(`INDEXED BY \`${RecallMessageIndex.name}\``) : sql.empty()}
    WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`

  // A missing index fails at prepare time, which the driver reports as a defect, so recover from the whole cause.
  const lookup = (db: Database.Interface["db"], ids: MessageID[], indexed: boolean) =>
    indexed
      ? db.all<MessageRow>(messages(ids, true)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => fallback(db, ids, Cause.squash(cause)),
          ),
        )
      : db.all<MessageRow>(messages(ids, false))

  // A missing or mismatched role index degrades to non-covering lookups, so report it once per connection.
  const fallback = (db: Database.Interface["db"], ids: MessageID[], error: unknown) =>
    Effect.gen(function* () {
      if (!degraded.has(db)) {
        degraded.add(db)
        yield* Effect.logWarning("recall role index unavailable, falling back to message row lookups", { error })
      }
      return yield* db.all<MessageRow>(messages(ids, false))
    })

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

  type Row = {
    partID: PartID
    messageID: MessageID
    sessionID: SessionID
    kind: "text" | "file" | "tool"
    text: string
  }

  type Hit = Row & {
    mask: number
    word: number
    phrase: boolean
  }

  type MessageRow = {
    id: MessageID
    role: "user" | "assistant"
    parentID: MessageID | ""
  }

  export const search = Effect.fn("RecallSearch.search")(function* (input: {
    query: string
    projectID: string
    directories: string[]
    limit?: number
    signal?: AbortSignal
    excludeSessionID?: SessionID
    excludeFromMessageID?: MessageID
  }) {
    const parsed = parse(input.query)
    const full = (1 << parsed.terms.length) - 1
    const limit = input.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search result limits must be integers from 1 to 50")
    }

    const roots = [...new Set(input.directories.map(Filesystem.resolve))]
    const empty: Output = { results: [], sessions: 0, candidates: 0, partial: false }
    if (roots.length === 0) return empty

    yield* abort(input.signal)
    const { db } = yield* Database.Service
    const projects = (yield* family(input.projectID)).map((id) => ProjectV2.ID.make(id))
    const rows = yield* db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        directory: SessionTable.directory,
        updated: SessionTable.time_updated,
      })
      .from(SessionTable)
      .where(inArray(SessionTable.project_id, projects))
      .all()
      .pipe(Effect.orDie)
    const items = new Map<SessionID, Item>()
    const scoped = new Map<string, boolean>()
    for (const row of rows) {
      const inside =
        scoped.get(row.directory) ??
        (() => {
          const directory = Filesystem.resolve(row.directory)
          const value = roots.some((root) => Filesystem.contains(root, directory))
          scoped.set(row.directory, value)
          return value
        })()
      if (!inside) continue

      const title = row.id === input.excludeSessionID ? "" : fold(row.title)
      const titleMask = mask(title, parsed.terms)
      const fuzzy = titleMask === full ? 0 : approximate(title, parsed.terms, titleMask)
      items.set(row.id, {
        id: row.id,
        title: row.title,
        directory: row.directory,
        updated: row.updated,
        matches: [],
        phrase: title.includes(parsed.phrase) ? 5 : 0,
        titleMask,
        sourceMask: { user: 0, assistant: 0, reference: 0, error: 0 },
        mask: titleMask | fuzzy,
        word: words(title, parsed.terms, titleMask),
        fuzzy,
        candidates: Array.from({ length: parsed.terms.length }),
      })
    }
    yield* abort(input.signal)
    if (items.size === 0) return empty
    const indexed = yield* ensure(db)

    const ids = [...items.keys()].sort()
    const excludeSessionID = input.excludeSessionID ?? ""
    const excludeFromMessageID = input.excludeFromMessageID ?? ""
    let candidates = 0

    const consume = (row: Hit, source: Source) => {
      const item = items.get(row.sessionID)
      if (!item) return

      item.mask |= row.mask
      item.word |= row.word
      item.sourceMask[source] |= row.mask
      item.phrase = Math.max(item.phrase, row.phrase ? weight(source) : 0)
      candidate(
        item.candidates,
        {
          source,
          partID: row.partID,
          mask: row.mask,
          word: row.word,
          phrase: row.phrase,
        },
        () => excerpt(row.text, parsed),
      )
    }

    for (let index = 0; index < ids.length; index += BATCH) {
      yield* abort(input.signal)
      const batch = ids.slice(index, index + BATCH)
      let cursor = { sessionID: "" as SessionID | "", partID: "" as PartID | "" }
      while (true) {
        const live = cursor.sessionID ? batch.filter((id) => id >= cursor.sessionID) : batch
        if (live.length === 0) break
        const found = yield* db.all<Row>(query(live, parsed.terms, cursor)).pipe(Effect.orDie)
        if (found.length === 0) break
        candidates += found.length
        const hits: Hit[] = []
        for (const row of found) {
          if (!row.text) continue
          const normalized = fold(row.text)
          const matched = mask(normalized, parsed.terms)
          if (matched === 0) continue
          hits.push({
            ...row,
            mask: matched,
            word: words(normalized, parsed.terms, matched),
            phrase: normalized.includes(parsed.phrase),
          })
        }
        const messages = new Map<MessageID, MessageRow>()
        const messageIDs = [...new Set(hits.map((row) => row.messageID))]
        for (let offset = 0; offset < messageIDs.length; offset += BATCH) {
          const rows = yield* lookup(db, messageIDs.slice(offset, offset + BATCH), indexed).pipe(Effect.orDie)
          for (const row of rows) messages.set(row.id, row)
        }
        for (const row of hits) {
          const message = messages.get(row.messageID)
          if (!message) continue
          if (row.sessionID === excludeSessionID) {
            if (message.role === "user" && message.id >= excludeFromMessageID) continue
            if (message.role === "assistant" && message.parentID >= excludeFromMessageID) continue
          }
          if (row.kind === "text") {
            if (message.role !== "user" && message.role !== "assistant") continue
            consume(row, message.role)
            continue
          }
          consume(row, row.kind === "file" ? "reference" : "error")
        }
        const last = found.at(-1)!
        cursor = { sessionID: last.sessionID, partID: last.partID }
        yield* pause
        yield* abort(input.signal)
        if (found.length < PAGE_SIZE) break
      }
    }
    yield* pause
    yield* abort(input.signal)

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
  })

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

  export function inert(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  }

  export function active(messages: MessageV2.WithParts[], messageID: MessageID) {
    const user = messages.findLast(
      (message) =>
        message.info.role === "user" && message.parts.some((part) => part.type !== "text" || !part.synthetic),
    )
    return user?.info.id ?? messageID
  }

  export function visible(messages: MessageV2.WithParts[], messageID: MessageID) {
    return messages.filter((message) => before(message.info, messageID))
  }

  function before(info: MessageV2.Info, messageID: MessageID) {
    if (info.role === "user") return info.id < messageID
    return info.parentID < messageID
  }

  const family = Effect.fn("RecallSearch.family")(function* (id: string) {
    const { db } = yield* Database.Service
    const row = yield* db
      .select({ worktree: ProjectTable.worktree })
      .from(ProjectTable)
      .where(eq(ProjectTable.id, ProjectV2.ID.make(id)))
      .get()
      .pipe(Effect.orDie)
    const root = row?.worktree ? Filesystem.resolve(row.worktree) : undefined
    if (!root || root === path.parse(root).root) return [id]
    const ids = (yield* db
      .select({ id: ProjectTable.id })
      .from(ProjectTable)
      .where(eq(ProjectTable.worktree, AbsolutePath.make(root)))
      .all()
      .pipe(Effect.orDie)).map((item) => item.id)
    return ids.length ? ids : [id]
  })

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
    if (!signal?.aborted) return Effect.void
    return Effect.fail(signal.reason ?? new Error("Recall search aborted"))
  }

  const pause = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}
