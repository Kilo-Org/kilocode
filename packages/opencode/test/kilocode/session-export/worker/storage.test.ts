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

  test("increments chunk ref count directly", () => {
    storage.upsertChunk({ id: "h1", bytes: new Uint8Array([1, 2, 3]), size: 3, encoding: "zstd" })
    storage.incrementRefCount("h1")

    const chunk = storage.getChunk("h1")
    expect(chunk?.refCount).toBe(2)
  })

  test("preserves duplicate chunk references for upload cleanup", () => {
    storage.upsertChunk({ id: "h1", bytes: new Uint8Array([1, 2, 3]), size: 3, encoding: "zstd" })
    storage.incrementRefCount("h1")
    storage.insertEvent({
      id: "e1",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      type: "tool_executed",
      ts: 100,
      agentVersion: "v0",
      dataJson: JSON.stringify({ inputChunkIds: ["h1"], outputChunkIds: ["h1"] }),
      clientScrubbed: 1,
    })

    const refs = storage.chunkRefsForEvents(["e1"])
    const chunks = storage.chunksForEvents(["e1"])
    storage.commitUploaded(["e1"], refs)

    expect(refs).toEqual(["h1", "h1"])
    expect(chunks.map((chunk) => chunk.id)).toEqual(["h1"])
    expect(storage.getChunk("h1")).toBeUndefined()
  })

  test("does not duplicate chunked references", () => {
    storage.insertEvent({
      id: "e1",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      type: "tool_executed",
      ts: 100,
      agentVersion: "v0",
      dataJson: JSON.stringify({
        output: { textParts: [{ __chunked: true, chunkIds: ["h1"], size: 3, encoding: "utf8" }] },
      }),
      clientScrubbed: 1,
    })

    expect(storage.chunkRefsForEvents(["e1"])).toEqual(["h1"])
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

  test("pendingEvents caps result set so a backlog cannot blow up heap", () => {
    for (let i = 0; i < 600; i += 1) {
      storage.insertEvent({
        id: String(i).padStart(4, "0"),
        schemaVersion: 1,
        sessionId: "s1",
        rootSessionId: "s1",
        seq: i,
        type: "llm_request_started",
        ts: i,
        agentVersion: "v0",
        dataJson: "{}",
        clientScrubbed: 1,
      })
    }
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000_000 }).length).toBe(500)
  })

  test("keeps worker schema out of main drizzle migration glob", async () => {
    const root = join(import.meta.dir, "../../../..")
    const files = await Array.fromAsync(new Bun.Glob("src/**/*.sql.ts").scan({ cwd: root }))
    expect(files.some((file) => file.includes("session-export"))).toBe(false)
  })
})
