import path from "path"
import { eq, inArray } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { MessageV2 } from "@/session/message-v2"
import { SessionTable } from "@/session/session.sql"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"

export namespace RecallSearch {
  const PAGE_SIZE = 1_024
  const MAX_QUERY = 256
  const MAX_TERMS = 12
  const MAX_SNIPPETS = 3
  const SNIPPET_CHARS = 360
  const SNIPPET_CONTEXT = 120
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

  const FIELDS_SQL = `
    p.id AS partID,
    p.session_id AS sessionID,
    CASE
      WHEN json_extract(p.data, '$.type') = 'text' THEN json_extract(m.data, '$.role')
      WHEN json_extract(p.data, '$.type') = 'file' THEN 'reference'
      ELSE 'error'
    END AS source,
    CASE
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
    END AS text`

  const FILTER_SQL = `
    (json_extract(p.data, '$.type') = 'text'
      AND json_extract(m.data, '$.role') IN ('user', 'assistant')
      AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
      AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0)
    OR json_extract(p.data, '$.type') = 'file'
    OR (json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.state.status') = 'error')`

  const SEARCH_SQL = `
    SELECT ${FIELDS_SQL}
    FROM json_each(?) AS ids
    CROSS JOIN part AS p
    CROSS JOIN message AS m
    WHERE p.id = ids.value
      AND m.id = p.message_id
      AND m.session_id = p.session_id
      AND NOT (
        m.session_id = ? AND (
          (json_extract(m.data, '$.role') = 'user' AND m.id >= ?)
          OR (json_extract(m.data, '$.role') = 'assistant' AND json_extract(m.data, '$.parentID') >= ?)
        )
      )
      AND (${FILTER_SQL})`

  const PAGE_SQL = `
    SELECT p.rowid AS rowid, p.id AS partID
    FROM part AS p INDEXED BY part_session_idx
    WHERE p.session_id = ? AND p.rowid > ? AND p.rowid <= ? AND p.id <= ?
    ORDER BY p.rowid
    LIMIT ${PAGE_SIZE}`

  const END_ROWID_SQL = "SELECT max(rowid) AS rowid FROM part"
  const END_ID_SQL = "SELECT max(id) AS id FROM part"

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
    parts: number
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
    sessionID: SessionID
    source: Source
    text: string
  }

  type PageRow = {
    rowid: number
    partID: PartID
  }

  export async function search(input: {
    query: string
    projectID: string
    directories: string[]
    limit?: number
    signal?: AbortSignal
    excludeSessionID?: SessionID
    excludeFromMessageID?: MessageID
  }): Promise<Output> {
    const parsed = parse(input.query)
    const limit = input.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search result limits must be integers from 1 to 50")
    }

    const roots = [...new Set(input.directories.map(Filesystem.resolve))]
    if (roots.length === 0) return { results: [], sessions: 0, parts: 0 }

    abort(input.signal)
    const projects = family(input.projectID).map((id) => ProjectID.make(id))
    const rows = Database.use((db) =>
      db
        .select({
          id: SessionTable.id,
          title: SessionTable.title,
          directory: SessionTable.directory,
          updated: SessionTable.time_updated,
        })
        .from(SessionTable)
        .where(inArray(SessionTable.project_id, projects))
        .all(),
    )
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
    abort(input.signal)
    if (items.size === 0) return { results: [], sessions: 0, parts: 0 }

    const ids = [...items.keys()]
    const sqlite = Database.Client().$client
    const rowid = sqlite.prepare<{ rowid: number | null }, []>(END_ROWID_SQL).get()?.rowid ?? 0
    const partID = sqlite.prepare<{ id: string | null }, []>(END_ID_SQL).get()?.id ?? ""
    const statement = sqlite.prepare<Row, [string, string, string, string]>(SEARCH_SQL)
    const page = sqlite.prepare<PageRow, [string, number, number, string]>(PAGE_SQL)
    const excludeSessionID = input.excludeSessionID ?? ""
    const excludeFromMessageID = input.excludeFromMessageID ?? ""
    let parts = 0

    const consume = (row: Row) => {
      const item = items.get(row.sessionID)
      if (!item || !row.text) return

      const normalized = fold(row.text)
      const matched = mask(normalized, parsed.terms)
      if (matched === 0) return

      item.mask |= matched
      item.sourceMask[row.source] |= matched
      const phrase = normalized.includes(parsed.phrase)
      item.phrase = Math.max(item.phrase, phrase ? weight(row.source) : 0)
      candidate(
        item.candidates,
        {
          source: row.source,
          partID: row.partID,
          mask: matched,
          phrase,
        },
        () => excerpt(row.text, parsed),
      )
    }

    for (let index = 0; index < ids.length; index++) {
      abort(input.signal)
      const sessionID = ids[index]
      let cursor = 0
      while (cursor < rowid) {
        const rows = page.all(sessionID, cursor, rowid, partID)
        if (rows.length === 0) break
        cursor = rows.at(-1)!.rowid
        for (const row of statement.iterate(
          JSON.stringify(rows.map((entry) => entry.partID)),
          excludeSessionID,
          excludeFromMessageID,
          excludeFromMessageID,
        )) {
          consume(row)
        }
        parts += rows.length
        if (rows.length < PAGE_SIZE) break
        await pause()
        abort(input.signal)
      }
      if (index % 16 !== 15) continue
      await pause()
      abort(input.signal)
    }
    await pause()
    abort(input.signal)

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
      parts,
    }
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

  function family(id: string) {
    const row = Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, ProjectID.make(id)))
        .get(),
    )
    const root = row?.worktree ? Filesystem.resolve(row.worktree) : undefined
    if (!root || root === path.parse(root).root) return [id]
    const ids = Database.use((db) =>
      db
        .select({ id: ProjectTable.id })
        .from(ProjectTable)
        .where(eq(ProjectTable.worktree, root))
        .all()
        .map((item) => item.id),
    )
    return ids.length ? ids : [id]
  }

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
    if (!signal?.aborted) return
    throw signal.reason ?? new Error("Recall search aborted")
  }

  function pause() {
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
