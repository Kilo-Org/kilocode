import { Config } from "../config"
import type { BatchEnvelope, JsonObject, JsonValue, UploadedEvent } from "../envelope"
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
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class Uploader {
  private timer: ReturnType<typeof setTimeout> | undefined
  private periodic: ReturnType<typeof setInterval> | undefined
  private active: Promise<void> | undefined
  private requested = false
  private next = 0

  constructor(private readonly deps: UploaderDeps) {
    this.periodic = setInterval(() => this.scheduleFlush("periodic"), Config.flushIntervalMs)
    this.periodic?.unref?.()
    this.scheduleFlush("startup")
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
        const compact = await compactEvents(
          rows.map(
            (row): UploadedEvent => ({
              ...parseObject(row.dataJson),
              id: row.id,
              type: row.type,
              sessionId: row.sessionId,
              rootSessionId: row.rootSessionId,
              ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
              ...(row.requestId ? { requestId: row.requestId } : {}),
              seq: row.seq,
              ts: row.ts,
            }),
          ),
        )
        const batch: BatchEnvelope = {
          schemaVersion: 1,
          agentVersion: this.deps.agentVersion,
          surface: this.deps.surface,
          batchId,
          events: compact.events,
          ...(Object.keys(compact.systemPrompts).length > 0 ? { systemPrompts: compact.systemPrompts } : {}),
          ...(Object.keys(compact.toolSchemas).length > 0 ? { toolSchemas: compact.toolSchemas } : {}),
          ...(Object.keys(compact.permissionSets).length > 0 ? { permissionSets: compact.permissionSets } : {}),
          ...(Object.keys(compact.agents).length > 0 ? { agents: compact.agents } : {}),
          chunks: chunks.map((chunk) => ({
            id: chunk.id,
            bytes: Buffer.from(chunk.bytes).toString("base64"),
            size: chunk.size,
            encoding: "zstd+base64",
          })),
        }
        const body = JSON.stringify(batch)
        await this.throttle()
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
        const chunkIds = this.deps.storage.chunkRefsForEvents(eventIds)
        if (res.ok) {
          const deleted = this.deps.storage.commitUploaded(eventIds, chunkIds)
          this.deps.reportTelemetry({
            kind: "telemetry",
            name: "session_export.uploaded",
            props: { events: deleted.events, chunks: deleted.chunks, batchId },
          })
          continue
        }
        if (terminal(res.status)) {
          this.deps.storage.commitUploaded(eventIds, chunkIds)
          this.deps.reportTelemetry({
            kind: "telemetry",
            name: "session_export.upload_4xx",
            props: { status: res.status, batchId },
          })
          continue
        }
        const retryAt = Date.now()
        const delay = retryAfter(res.headers) ?? backoffFor(rows[0]?.uploadAttempts ?? 0)
        for (const row of rows) this.deps.storage.markRetry(row.id, retryAt + delay)
        this.deps.reportTelemetry({
          kind: "telemetry",
          name: "session_export.upload_retryable",
          props: { status: res.status, batchId },
        })
        return
      }
    } catch (err) {
      const retryAt = Date.now()
      for (const row of rows) this.deps.storage.markRetry(row.id, retryAt + backoffFor(row.uploadAttempts))
      this.deps.reportTelemetry({
        kind: "telemetry",
        name: "session_export.upload_network_error",
        props: { message: String(err) },
      })
    }
  }

  private async throttle(): Promise<void> {
    const now = this.deps.now?.() ?? Date.now()
    const wait = this.next - now
    if (wait > 0) await (this.deps.sleep ?? sleep)(wait)
    const after = this.deps.now?.() ?? Date.now()
    this.next = Math.max(after, this.next) + Config.uploadRateLimitIntervalMs
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function backoffFor(attempts: number): number {
  const exponent = Math.max(0, attempts)
  const grown = Config.retryBackoffMinMs * 2 ** Math.min(exponent, 16)
  return Math.min(grown, Config.retryBackoffMaxMs)
}

function terminal(status: number): boolean {
  if (status === 400) return true
  if (status === 413) return true
  if (status === 422) return true
  return false
}

function retryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after")
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return undefined
  return Math.max(0, time - Date.now())
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
  const session = rows
    .filter((row) => row.rootSessionId === first.rootSessionId && row.sessionId === first.sessionId)
    .sort((a, b) => a.seq - b.seq)
  const out: typeof session = []
  for (const row of session) {
    const prev = out.at(-1)
    if (prev && row.seq !== prev.seq + 1) break
    out.push(row)
  }
  return out
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function parseObject(value: string): JsonObject {
  const json = JSON.parse(value) as JsonValue
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new Error("stored event payload must be a JSON object")
  return json
}

type Compact = {
  events: UploadedEvent[]
  systemPrompts: Record<string, JsonValue>
  toolSchemas: Record<string, JsonValue>
  permissionSets: Record<string, JsonValue>
  agents: Record<string, JsonValue>
}

async function compactEvents(events: UploadedEvent[]): Promise<Compact> {
  const out: Compact = { events: [], systemPrompts: {}, toolSchemas: {}, permissionSets: {}, agents: {} }
  for (const event of events) {
    const next: UploadedEvent = { ...event }
    if (next.type !== "llm_request_started") {
      out.events.push(next)
      continue
    }
    const input = object(next.input)
    if (input) {
      next.input = { ...input }
      const copy = next.input as JsonObject
      if (copy.system !== undefined) {
        copy.systemRef = await intern(out.systemPrompts, copy.system)
        delete copy.system
      }
      if (copy.tools !== undefined) {
        copy.toolSchemaRef = await intern(out.toolSchemas, copy.tools)
        delete copy.tools
      }
      if (copy.permissions !== undefined) {
        copy.permissionRef = await intern(out.permissionSets, copy.permissions)
        delete copy.permissions
      }
    }
    if (next.agentInfo !== undefined) {
      next.agentRef = await intern(out.agents, next.agentInfo)
      delete next.agentInfo
    }
    out.events.push(next)
  }
  return out
}

async function intern(dict: Record<string, JsonValue>, value: JsonValue): Promise<string> {
  const id = await sha256Hex(stable(value))
  dict[id] = value
  return id
}

function object(value: JsonValue | undefined): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value
}

function stable(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
