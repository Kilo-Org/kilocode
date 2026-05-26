import { Config } from "../config"
import type { FromWorker } from "./ipc"
import type { Storage } from "./storage"
import { readFile } from "node:fs/promises"

export type UploaderDeps = {
  storage: Storage
  endpoint: string
  fetch: (input: string, init: RequestInit) => Promise<Response>
  reportTelemetry: (msg: Extract<FromWorker, { kind: "telemetry" }>) => void
  agentVersion: string
  surface: string
  anonId?: string
  anonIdPath?: string
}

export class Uploader {
  private timer: ReturnType<typeof setTimeout> | undefined
  private periodic: ReturnType<typeof setInterval> | undefined
  private active: Promise<void> | undefined
  private requested = false

  constructor(private readonly deps: UploaderDeps) {
    this.periodic = setInterval(() => this.scheduleFlush("periodic"), Config.flushIntervalMs)
    this.periodic?.unref?.()
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.periodic) clearInterval(this.periodic)
    this.timer = undefined
    this.periodic = undefined
  }

  scheduleFlush(_reason: string): void {
    if (this.active) {
      this.requested = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush("scheduled"), 0)
  }

  async flush(_reason: string): Promise<void> {
    if (this.active) {
      this.requested = true
      return this.active
    }
    this.active = this.run()
    try {
      await this.active
    } finally {
      this.active = undefined
    }
  }

  private async run(): Promise<void> {
    do {
      this.requested = false
      await this.drain()
    } while (this.requested)
  }

  private async drain(): Promise<void> {
    let rows: ReturnType<Storage["pendingEvents"]> = []
    try {
      while (true) {
        const now = Date.now()
        rows = sessionRows(this.deps.storage.pendingEvents({ now, limitBytes: Config.flushSizeBytes }))
        if (rows.length === 0) return
        const batchId = await sha256Hex(rows.map((row) => row.id).join("\n"))
        const chunks = this.deps.storage.chunksForEvents(rows.map((row) => row.id))
        const body = JSON.stringify({
          schemaVersion: 1,
          agentVersion: this.deps.agentVersion,
          surface: this.deps.surface,
          batchId,
          events: rows.map((row) => ({
            ...JSON.parse(row.dataJson),
            id: row.id,
            type: row.type,
            sessionId: row.sessionId,
            rootSessionId: row.rootSessionId,
            seq: row.seq,
            ts: row.ts,
          })),
          chunks: chunks.map((chunk) => ({
            id: chunk.id,
            bytes: Buffer.from(chunk.bytes).toString("base64"),
            size: chunk.size,
            encoding: "zstd+base64",
          })),
        })
        const res = await this.deps.fetch(this.deps.endpoint, {
          method: "POST",
          headers: await headers({
            rows,
            body,
            batchId,
            agentVersion: this.deps.agentVersion,
            surface: this.deps.surface,
            anonId: this.deps.anonId,
            anonIdPath: this.deps.anonIdPath,
          }),
          body,
        })
        const eventIds = rows.map((row) => row.id)
        const chunkIds = chunks.map((chunk) => chunk.id)
        if (res.ok) {
          const deleted = this.deps.storage.commitUploaded(eventIds, chunkIds)
          this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.uploaded", props: { events: deleted.events, chunks: deleted.chunks, batchId } })
          continue
        }
        if (res.status >= 400 && res.status < 500) {
          this.deps.storage.commitUploaded(eventIds, chunkIds)
          this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.upload_4xx", props: { status: res.status, batchId } })
          continue
        }
        const retryAt = Date.now()
        for (const row of rows) this.deps.storage.markRetry(row.id, retryAt + backoffFor(row.uploadAttempts))
        return
      }
    } catch (err) {
      const retryAt = Date.now()
      for (const row of rows) this.deps.storage.markRetry(row.id, retryAt + backoffFor(row.uploadAttempts))
      this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.upload_network_error", props: { message: String(err) } })
    }
  }
}

export function backoffFor(attempts: number): number {
  const exponent = Math.max(0, attempts)
  const grown = Config.retryBackoffMinMs * 2 ** Math.min(exponent, 16)
  return Math.min(grown, Config.retryBackoffMaxMs)
}

type HeaderArgs = {
  rows: ReturnType<Storage["pendingEvents"]>
  body: string
  batchId: string
  agentVersion: string
  surface: string
  anonId?: string
  anonIdPath?: string
}

async function headers(args: HeaderArgs): Promise<Headers> {
  const seqs = args.rows.map((row) => row.seq)
  const first = args.rows[0]
  const out = new Headers({
    "content-type": "application/json",
    "x-kilo-export-api-version": "1",
    "x-kilo-export-schema-version": "1",
    "x-kilo-export-agent-version": args.agentVersion,
    "x-kilo-export-surface": args.surface,
    "x-kilo-export-root-session-id": first.rootSessionId,
    "x-kilo-export-session-id": first.sessionId,
    "x-kilo-export-batch-id": args.batchId,
    "x-kilo-export-seq-start": String(Math.min(...seqs)),
    "x-kilo-export-seq-end": String(Math.max(...seqs)),
    "x-kilo-export-event-count": String(args.rows.length),
    "x-kilo-export-payload-sha256": await sha256Hex(args.body),
    "x-kilo-export-client-sent-at": new Date().toISOString(),
    "x-kilo-export-content-encoding": "identity",
  })
  const token = process.env.KILO_SESSION_EXPORT_AUTH_TOKEN
  if (token) out.set("authorization", `Bearer ${token}`)
  const anon = args.anonId ?? (await anonId(args.anonIdPath))
  if (!token && anon) out.set("x-kilo-anon-id", anon)
  return out
}

async function anonId(file: string | undefined): Promise<string | undefined> {
  if (!file) return undefined
  const text = await readFile(file, "utf8").catch(() => undefined)
  const id = text?.trim()
  if (!id) return undefined
  return id
}

function sessionRows(rows: ReturnType<Storage["pendingEvents"]>): ReturnType<Storage["pendingEvents"]> {
  const first = rows[0]
  if (!first) return []
  return rows.filter((row) => row.rootSessionId === first.rootSessionId && row.sessionId === first.sessionId)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
