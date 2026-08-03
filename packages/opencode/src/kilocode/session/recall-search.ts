import path from "path"
import { eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { RecallPartIndex } from "@opencode-ai/core/kilocode/session/recall-part-index"
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
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
  const ready = new WeakSet<object>()

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
    WHERE p.session_id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )})
      AND (p.session_id > ${cursor.sessionID} OR (p.session_id = ${cursor.sessionID} AND p.id > ${cursor.partID}))
      AND (${sql.raw(PART_FILTER_SQL)})
      AND (
        ${sql.join(
          terms.map((term) => sql`instr(lower(${sql.raw(TEXT_SQL)}), ${term}) > 0`),
          sql` OR `,
        )}
        OR ${sql.raw(TEXT_SQL)} GLOB ('*[^' || char(1) || '-' || char(127) || ']*')
      )
    ORDER BY p.session_id, p.id
    LIMIT ${PAGE_SIZE}`

  const ensure = (db: Database.Interface["db"]) =>
    Effect.gen(function* () {
      if (ready.has(db)) return
      yield* db.run(sql.raw(RecallPartIndex.createSql)).pipe(
        Effect.tap(() => Effect.sync(() => ready.add(db))),
        Effect.catch((error) => Effect.logWarning("recall index unavailable", { error })),
      )
    })

  const messageSql = (ids: MessageID[]) => sql`
    SELECT
      id,
      json_extract(data, '$.role') AS role,
      coalesce(json_extract(data, '$.parentID'), '') AS parentID
    FROM message
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )})`

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
  }

  export type Output = {
    results: Result[]
    sessions: number
    candidates: number
  }

  type Candidate = Match & {
    mask: number
    phrase: boolean
  }

  type Item = Result & {
    phrase: number
    titleMask: number
    sourceMask: Record<Source, number>
    mask: number
    candidates: Array<Candidate | undefined>
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
    const limit = input.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search result limits must be integers from 1 to 50")
    }

    const roots = [...new Set(input.directories.map(Filesystem.resolve))]
    if (roots.length === 0) return { results: [], sessions: 0, candidates: 0 }

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
    for (const row of rows) {
      const directory = Filesystem.resolve(row.directory)
      if (!roots.some((root) => Filesystem.contains(root, directory))) continue

      const title = row.id === input.excludeSessionID ? "" : fold(row.title)
      const titleMask = mask(title, parsed.terms)
      items.set(row.id, {
        id: row.id,
        title: row.title,
        directory: row.directory,
        updated: row.updated,
        matches: [],
        phrase: title.includes(parsed.phrase) ? 5 : 0,
        titleMask,
        sourceMask: { user: 0, assistant: 0, reference: 0, error: 0 },
        mask: titleMask,
        candidates: Array.from({ length: parsed.terms.length }),
      })
    }
    yield* abort(input.signal)
    if (items.size === 0) return { results: [], sessions: 0, candidates: 0 }
    yield* ensure(db)

    const ids = [...items.keys()].sort()
    const excludeSessionID = input.excludeSessionID ?? ""
    const excludeFromMessageID = input.excludeFromMessageID ?? ""
    let candidates = 0

    const consume = (row: Hit, source: Source) => {
      const item = items.get(row.sessionID)
      if (!item) return

      item.mask |= row.mask
      item.sourceMask[source] |= row.mask
      item.phrase = Math.max(item.phrase, row.phrase ? weight(source) : 0)
      candidate(
        item.candidates,
        {
          source,
          partID: row.partID,
          mask: row.mask,
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
          hits.push({ ...row, mask: matched, phrase: normalized.includes(parsed.phrase) })
        }
        const messages = new Map<MessageID, MessageRow>()
        const messageIDs = [...new Set(hits.map((row) => row.messageID))]
        for (let offset = 0; offset < messageIDs.length; offset += BATCH) {
          const rows = yield* db
            .all<MessageRow>(messageSql(messageIDs.slice(offset, offset + BATCH)))
            .pipe(Effect.orDie)
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

    const full = (1 << parsed.terms.length) - 1
    const best: Item[] = []
    for (const item of items.values()) {
      if ((item.mask & full) !== full) continue
      item.matches = snippets(item, full)
      best.push(item)
      best.sort(compare)
      if (best.length > limit) best.pop()
    }

    return {
      results: best.map(
        ({ phrase: _phrase, titleMask: _title, sourceMask: _source, mask: _mask, candidates: _candidates, ...item }) =>
          item,
      ),
      sessions: items.size,
      candidates,
    }
  })

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
    return { phrase, terms }
  }

  function fold(value: string) {
    return value.normalize("NFKC").toLowerCase()
  }

  function mask(value: string, terms: string[]) {
    return terms.reduce((result, term, index) => result | (value.includes(term) ? 1 << index : 0), 0)
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
    if (weight(a.source) !== weight(b.source)) return weight(b.source) - weight(a.source)
    if (bits(a.mask) !== bits(b.mask)) return bits(b.mask) - bits(a.mask)
    return a.partID.localeCompare(b.partID)
  }

  function snippets(item: Item, full: number) {
    const candidates = [...new Set(item.candidates.filter((value) => value !== undefined))]
    const result: Match[] = []
    let missing = full & ~item.titleMask
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

  function excerpt(text: string, query: { phrase: string; terms: string[] }) {
    const raw = text.toLowerCase()
    const phrase = raw.indexOf(query.phrase)
    const positions = query.terms.map((term) => raw.indexOf(term)).filter((position) => position >= 0)
    const direct = phrase >= 0 ? phrase : positions.length ? Math.min(...positions) : -1
    const ascii = direct >= 0 && !/[^\x00-\x7F]/.test(text.slice(0, direct))
    const position = ascii ? direct : locate(text, query)
    const start = Math.max(0, position - SNIPPET_CONTEXT)
    const value = text.slice(start, start + SNIPPET_CHARS).trim()
    return `${start > 0 ? "..." : ""}${value}${start + SNIPPET_CHARS < text.length ? "..." : ""}`
  }

  function locate(text: string, query: { phrase: string; terms: string[] }) {
    const normalized = fold(text)
    const phrase = normalized.indexOf(query.phrase)
    const positions = query.terms.map((term) => normalized.indexOf(term)).filter((position) => position >= 0)
    const target = phrase >= 0 ? phrase : positions.length ? Math.min(...positions) : 0
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
