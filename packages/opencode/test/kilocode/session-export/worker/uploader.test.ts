import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Uploader } from "@/kilocode/session-export/worker/uploader"

describe("Uploader", () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-export-"))
    storage = new Storage(join(dir, "session-export.db"))
    storage.migrate()
    storage.insertEvent({
      id: "01",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      type: "llm_request_started",
      ts: 100,
      agentVersion: "v0",
      dataJson: '{"requestId":"r1"}',
      clientScrubbed: 1,
    })
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("2xx response marks rows uploaded and deletes them", async () => {
    const telemetry: unknown[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => new Response("", { status: 204 }),
      reportTelemetry: (msg) => telemetry.push(msg),
      agentVersion: "v0",
    })
    await uploader.flush("test")
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 }).length).toBe(0)
    expect(telemetry.some((item) => (item as { name?: string }).name === "session_export.uploaded")).toBe(true)
  })

  test("4xx response drops rows without retry", async () => {
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => new Response("", { status: 400 }),
      reportTelemetry: () => {},
      agentVersion: "v0",
    })
    await uploader.flush("test")
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 }).length).toBe(0)
  })

  test("5xx response backs rows off", async () => {
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => new Response("", { status: 500 }),
      reportTelemetry: () => {},
      agentVersion: "v0",
    })
    await uploader.flush("test")
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 }).length).toBe(0)
  })
})
