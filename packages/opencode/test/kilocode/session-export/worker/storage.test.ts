import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"

describe("Storage", () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-export-"))
    storage = new Storage(join(dir, "session-export.db"))
    storage.migrate()
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("inserts and reads back an event row", () => {
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

    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe("01")
  })

  test("upserts chunks with ref count increment", () => {
    storage.upsertChunk({ id: "h1", bytes: new Uint8Array([1, 2, 3]), size: 3, encoding: "zstd" })
    storage.upsertChunk({ id: "h1", bytes: new Uint8Array([1, 2, 3]), size: 3, encoding: "zstd" })

    const chunk = storage.getChunk("h1")
    expect(chunk?.refCount).toBe(2)
  })

  test("pendingEvents respects next_attempt_at backoff", () => {
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      type: "llm_request_started",
      ts: 100,
      agentVersion: "v0",
      dataJson: "{}",
      clientScrubbed: 1,
    })
    storage.markRetry("02", 500)

    expect(storage.pendingEvents({ now: 400, limitBytes: 1_000_000 }).length).toBe(0)
    expect(storage.pendingEvents({ now: 600, limitBytes: 1_000_000 }).length).toBe(1)
  })

  test("dbSize reports approximate disk usage", () => {
    expect(storage.dbSize()).toBeGreaterThan(0)
  })
})
