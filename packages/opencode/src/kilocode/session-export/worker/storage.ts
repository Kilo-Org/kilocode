import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite"
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import type { ExportEventType } from "../envelope"
import { ChunkTable, EventTable } from "./schema"

const tables = { ChunkTable, EventTable }

type Client = SQLiteBunDatabase<typeof tables> & { $client: Database }
type Prepared = Statement<unknown, SQLQueryBindings[]>

export type EventRow = {
  id: string
  schemaVersion: number
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  seq: number
  requestId?: string
  type: ExportEventType
  ts: number
  agentVersion: string
  dataJson: string
  clientScrubbed: 0 | 1
}

export type PendingEventRow = EventRow & {
  uploadAttempts: number
}

export type ChunkRow = {
  id: string
  bytes: Uint8Array
  size: number
  encoding: "zstd"
}

export class Storage {
  private readonly sqlite: Database
  private readonly db: Client

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.db = drizzle({ client: finalizing(this.sqlite), schema: tables }) as Client
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA synchronous = NORMAL")
    this.sqlite.exec("PRAGMA busy_timeout = 5000")
  }

  migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS event (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1,
        session_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        parent_session_id TEXT,
        seq INTEGER NOT NULL,
        request_id TEXT,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        agent_version TEXT NOT NULL,
        data_json TEXT NOT NULL,
        client_scrubbed INTEGER NOT NULL DEFAULT 1,
        uploaded_at INTEGER,
        upload_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS event_session_seq ON event(session_id, seq);
      CREATE INDEX IF NOT EXISTS event_pending ON event(uploaded_at, next_attempt_at) WHERE uploaded_at IS NULL;

      CREATE TABLE IF NOT EXISTS chunk (
        id TEXT PRIMARY KEY,
        bytes BLOB NOT NULL,
        size INTEGER NOT NULL,
        encoding TEXT NOT NULL,
        ref_count INTEGER NOT NULL,
        uploaded_at INTEGER
      );
    `)
  }

  insertEvent(row: EventRow): void {
    this.db
      .insert(EventTable)
      .values({
        id: row.id,
        schema_version: row.schemaVersion,
        session_id: row.sessionId,
        root_session_id: row.rootSessionId,
        parent_session_id: row.parentSessionId ?? null,
        seq: row.seq,
        request_id: row.requestId ?? null,
        type: row.type,
        ts: row.ts,
        agent_version: row.agentVersion,
        data_json: row.dataJson,
        client_scrubbed: row.clientScrubbed,
      })
      .run()
  }

  upsertChunk(row: ChunkRow): void {
    this.db
      .insert(ChunkTable)
      .values({ id: row.id, bytes: Buffer.from(row.bytes), size: row.size, encoding: row.encoding, ref_count: 1 })
      .onConflictDoUpdate({ target: ChunkTable.id, set: { ref_count: sql`${ChunkTable.ref_count} + 1` } })
      .run()
  }

  getChunk(id: string): { id: string; bytes: Uint8Array; refCount: number; size: number } | undefined {
    const row = this.db
      .select({ id: ChunkTable.id, bytes: ChunkTable.bytes, size: ChunkTable.size, ref_count: ChunkTable.ref_count })
      .from(ChunkTable)
      .where(eq(ChunkTable.id, id))
      .get()
    if (!row) return undefined
    return { id: row.id, bytes: row.bytes, refCount: row.ref_count, size: row.size }
  }

  pendingEvents(opts: { now: number; limitBytes: number }): PendingEventRow[] {
    const rows = this.db
      .select()
      .from(EventTable)
      .where(and(isNull(EventTable.uploaded_at), or(isNull(EventTable.next_attempt_at), lte(EventTable.next_attempt_at, opts.now))))
      .orderBy(asc(EventTable.ts))
      .limit(500)
      .all()
    const out: PendingEventRow[] = []
    let bytes = 0
    for (const row of rows) {
      bytes += row.data_json.length
      if (bytes > opts.limitBytes && out.length > 0) break
      out.push({
        id: row.id,
        schemaVersion: row.schema_version,
        sessionId: row.session_id,
        rootSessionId: row.root_session_id,
        parentSessionId: row.parent_session_id ?? undefined,
        seq: row.seq,
        requestId: row.request_id ?? undefined,
        type: row.type,
        ts: row.ts,
        agentVersion: row.agent_version,
        dataJson: row.data_json,
        clientScrubbed: row.client_scrubbed === 1 ? 1 : 0,
        uploadAttempts: row.upload_attempts ?? 0,
      })
    }
    return out
  }

  markRetry(id: string, next: number): void {
    this.db
      .update(EventTable)
      .set({ upload_attempts: sql`${EventTable.upload_attempts} + 1`, next_attempt_at: next })
      .where(eq(EventTable.id, id))
      .run()
  }

  markUploaded(ids: string[]): void {
    if (ids.length === 0) return
    this.db.update(EventTable).set({ uploaded_at: Date.now() }).where(inArray(EventTable.id, ids)).run()
  }

  deleteUploaded(): { events: number; chunks: number } {
    const events = this.db.delete(EventTable).where(isNotNull(EventTable.uploaded_at)).returning({ id: EventTable.id }).all().length
    const chunks = this.db.delete(ChunkTable).where(lte(ChunkTable.ref_count, 0)).returning({ id: ChunkTable.id }).all().length
    return { events, chunks }
  }

  decRefChunks(ids: string[]): void {
    if (ids.length === 0) return
    this.db
      .update(ChunkTable)
      .set({ ref_count: sql`${ChunkTable.ref_count} - 1` })
      .where(inArray(ChunkTable.id, ids))
      .run()
  }

  commitUploaded(eventIds: string[], chunkIds: string[]): { events: number; chunks: number } {
    return this.db.transaction((tx) => {
      if (eventIds.length > 0) {
        tx.update(EventTable).set({ uploaded_at: Date.now() }).where(inArray(EventTable.id, eventIds)).run()
      }
      if (chunkIds.length > 0) {
        tx.update(ChunkTable)
          .set({ ref_count: sql`${ChunkTable.ref_count} - 1` })
          .where(inArray(ChunkTable.id, chunkIds))
          .run()
      }
      const events = tx.delete(EventTable).where(isNotNull(EventTable.uploaded_at)).returning({ id: EventTable.id }).all().length
      const chunks = tx.delete(ChunkTable).where(lte(ChunkTable.ref_count, 0)).returning({ id: ChunkTable.id }).all().length
      return { events, chunks }
    })
  }

  chunksForEvents(ids: string[]): ChunkRow[] {
    if (ids.length === 0) return []
    const rows = this.db.select({ data_json: EventTable.data_json }).from(EventTable).where(inArray(EventTable.id, ids)).all()
    const chunkIds = new Set<string>()
    for (const row of rows) collectChunkIds(JSON.parse(row.data_json), chunkIds)
    if (chunkIds.size === 0) return []
    const chunks = this.db.select().from(ChunkTable).where(inArray(ChunkTable.id, [...chunkIds])).all()
    return chunks.map((row) => ({ id: row.id, bytes: row.bytes, size: row.size, encoding: row.encoding }))
  }

  dbSize(): number {
    const row = this.sqlite.query("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()").get() as
      | { size: number }
      | undefined
    return row?.size ?? 0
  }

  close(): void {
    this.sqlite.close()
  }
}

function finalizing(db: Database): Database {
  const client = Object.create(db) as Database
  const prepare = db.prepare.bind(db) as (query: string) => Prepared
  client.prepare = ((query: string) => wrap(prepare(query))) as Database["prepare"]
  client.exec = db.exec.bind(db)
  client.transaction = db.transaction.bind(db)
  return client
}

function wrap(stmt: Prepared): Prepared {
  const run = stmt.run.bind(stmt)
  const all = stmt.all.bind(stmt)
  const get = stmt.get.bind(stmt)
  const values = stmt.values.bind(stmt)
  stmt.run = (...params) => finish(stmt, () => run(...params))
  stmt.all = (...params) => finish(stmt, () => all(...params))
  stmt.get = (...params) => finish(stmt, () => get(...params))
  stmt.values = (...params) => finish(stmt, () => values(...params))
  return stmt
}

function finish<T>(stmt: Prepared, fn: () => T): T {
  try {
    return fn()
  } finally {
    stmt.finalize()
  }
}

function collectChunkIds(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) collectChunkIds(item, out)
    return
  }
  const record = node as Record<string, unknown>
  if (record.__chunked === true && Array.isArray(record.chunkIds)) {
    for (const id of record.chunkIds) {
      if (typeof id === "string") out.add(id)
    }
  }
  if (Array.isArray(record.chunkIds)) {
    for (const id of record.chunkIds) {
      if (typeof id === "string") out.add(id)
    }
  }
  if (Array.isArray(record.patchChunkIds)) {
    for (const id of record.patchChunkIds) {
      if (typeof id === "string") out.add(id)
    }
  }
  if (Array.isArray(record.inputChunkIds)) {
    for (const id of record.inputChunkIds) {
      if (typeof id === "string") out.add(id)
    }
  }
  if (Array.isArray(record.outputChunkIds)) {
    for (const id of record.outputChunkIds) {
      if (typeof id === "string") out.add(id)
    }
  }
  for (const val of Object.values(record)) collectChunkIds(val, out)
}
