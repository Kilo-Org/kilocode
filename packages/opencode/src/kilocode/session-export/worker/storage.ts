import { Database } from "bun:sqlite"
import type { ExportEventType } from "../envelope"

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

type EventRecord = {
  id: string
  schema_version: number
  session_id: string
  root_session_id: string
  parent_session_id: string | null
  seq: number
  request_id: string | null
  type: ExportEventType
  ts: number
  agent_version: string
  data_json: string
  client_scrubbed: number
  upload_attempts: number
}

type ChunkRecord = {
  id: string
  bytes: Uint8Array
  size: number
  encoding?: string
  ref_count: number
}

export class Storage {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
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
    this.sqlite
      .query(
        `INSERT INTO event (
          id, schema_version, session_id, root_session_id, parent_session_id, seq,
          request_id, type, ts, agent_version, data_json, client_scrubbed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.schemaVersion,
        row.sessionId,
        row.rootSessionId,
        row.parentSessionId ?? null,
        row.seq,
        row.requestId ?? null,
        row.type,
        row.ts,
        row.agentVersion,
        row.dataJson,
        row.clientScrubbed,
      )
  }

  upsertChunk(row: ChunkRow): void {
    this.sqlite
      .query(
        `INSERT INTO chunk (id, bytes, size, encoding, ref_count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET ref_count = ref_count + 1`,
      )
      .run(row.id, row.bytes, row.size, row.encoding)
  }

  getChunk(id: string): { id: string; bytes: Uint8Array; refCount: number; size: number } | undefined {
    const row = this.sqlite.query("SELECT id, bytes, size, ref_count FROM chunk WHERE id = ?").get(id) as
      | ChunkRecord
      | undefined
    if (!row) return undefined
    return { id: row.id, bytes: row.bytes, refCount: row.ref_count, size: row.size }
  }

  pendingEvents(opts: { now: number; limitBytes: number }): PendingEventRow[] {
    const rows = this.sqlite
      .query(
        `SELECT * FROM event
         WHERE uploaded_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY ts ASC
         LIMIT 500`,
      )
      .all(opts.now) as EventRecord[]
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
    this.sqlite.query("UPDATE event SET upload_attempts = upload_attempts + 1, next_attempt_at = ? WHERE id = ?").run(next, id)
  }

  markUploaded(ids: string[]): void {
    if (ids.length === 0) return
    const vars = ids.map(() => "?").join(",")
    this.sqlite.query(`UPDATE event SET uploaded_at = ? WHERE id IN (${vars})`).run(Date.now(), ...ids)
  }

  deleteUploaded(): { events: number; chunks: number } {
    const events = this.sqlite.query("DELETE FROM event WHERE uploaded_at IS NOT NULL").run().changes
    const chunks = this.sqlite.query("DELETE FROM chunk WHERE ref_count <= 0").run().changes
    return { events, chunks }
  }

  decRefChunks(ids: string[]): void {
    if (ids.length === 0) return
    const vars = ids.map(() => "?").join(",")
    this.sqlite.query(`UPDATE chunk SET ref_count = ref_count - 1 WHERE id IN (${vars})`).run(...ids)
  }

  commitUploaded(eventIds: string[], chunkIds: string[]): { events: number; chunks: number } {
    return this.sqlite.transaction(() => {
      this.markUploaded(eventIds)
      this.decRefChunks(chunkIds)
      return this.deleteUploaded()
    })()
  }

  chunksForEvents(ids: string[]): ChunkRow[] {
    if (ids.length === 0) return []
    const vars = ids.map(() => "?").join(",")
    const rows = this.sqlite.query(`SELECT data_json FROM event WHERE id IN (${vars})`).all(...ids) as { data_json: string }[]
    const chunkIds = new Set<string>()
    for (const row of rows) collectChunkIds(JSON.parse(row.data_json), chunkIds)
    if (chunkIds.size === 0) return []
    const chunkVars = [...chunkIds].map(() => "?").join(",")
    const chunks = this.sqlite.query(`SELECT id, bytes, size, encoding, ref_count FROM chunk WHERE id IN (${chunkVars})`).all(...chunkIds) as ChunkRecord[]
    return chunks.map((row) => ({ id: row.id, bytes: row.bytes, size: row.size, encoding: "zstd" }))
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
