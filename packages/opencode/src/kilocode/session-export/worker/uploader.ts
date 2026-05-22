import { Config } from "../config"
import type { FromWorker } from "./ipc"
import type { Storage } from "./storage"

export type UploaderDeps = {
  storage: Storage
  endpoint: string
  fetch: (input: string, init: RequestInit) => Promise<Response>
  reportTelemetry: (msg: Extract<FromWorker, { kind: "telemetry" }>) => void
  agentVersion: string
}

export class Uploader {
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushing = false

  constructor(private readonly deps: UploaderDeps) {}

  scheduleFlush(_reason: string): void {
    if (this.flushing) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush("scheduled"), 0)
  }

  async flush(_reason: string): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      const now = Date.now()
      const rows = this.deps.storage.pendingEvents({ now, limitBytes: Config.flushSizeBytes })
      if (rows.length === 0) return
      const batchId = crypto.randomUUID()
      const body = JSON.stringify({
        schemaVersion: 1,
        agentVersion: this.deps.agentVersion,
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
        chunks: this.deps.storage.chunksForEvents(rows.map((row) => row.id)),
      })
      const res = await this.deps.fetch(this.deps.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
      if (res.ok) {
        this.deps.storage.markUploaded(rows.map((row) => row.id))
        const deleted = this.deps.storage.deleteUploaded()
        this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.uploaded", props: { events: deleted.events, chunks: deleted.chunks, batchId } })
        return
      }
      if (res.status >= 400 && res.status < 500) {
        this.deps.storage.markUploaded(rows.map((row) => row.id))
        this.deps.storage.deleteUploaded()
        this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.upload_4xx", props: { status: res.status, batchId } })
        return
      }
      for (const row of rows) this.deps.storage.markRetry(row.id, Date.now() + Config.retryBackoffMinMs)
    } catch (err) {
      const rows = this.deps.storage.pendingEvents({ now: Date.now(), limitBytes: Config.flushSizeBytes })
      for (const row of rows) this.deps.storage.markRetry(row.id, Date.now() + Config.retryBackoffMinMs)
      this.deps.reportTelemetry({ kind: "telemetry", name: "session_export.upload_network_error", props: { message: String(err) } })
    } finally {
      this.flushing = false
    }
  }
}
