import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Uploader } from "@/kilocode/session-export/worker/uploader"

describe("Uploader", () => {
  let dir: string
  let storage: Storage
  let token: string | undefined

  beforeEach(() => {
    token = process.env.KILO_SESSION_EXPORT_AUTH_TOKEN
    delete process.env.KILO_SESSION_EXPORT_AUTH_TOKEN
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
    if (token === undefined) delete process.env.KILO_SESSION_EXPORT_AUTH_TOKEN
    else process.env.KILO_SESSION_EXPORT_AUTH_TOKEN = token
  })

  test("2xx response marks rows uploaded and deletes them", async () => {
    const telemetry: unknown[] = []
    const calls: Array<{ input: string; init: RequestInit }> = []
    process.env.KILO_SESSION_EXPORT_AUTH_TOKEN = "local-token"
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (input, init) => {
        calls.push({ input, init })
        return new Response("", { status: 204 })
      },
      reportTelemetry: (msg) => telemetry.push(msg),
      agentVersion: "v0",
      surface: "test",
    })
    await uploader.flush("test")
    const headers = new Headers(calls[0].init.headers)
    const body = calls[0].init.body as string
    expect(calls[0].input).toBe("https://example.test/ingest")
    expect(headers.get("x-kilo-export-api-version")).toBe("1")
    expect(headers.get("x-kilo-export-schema-version")).toBe("1")
    expect(headers.get("x-kilo-export-agent-version")).toBe("v0")
    expect(headers.get("x-kilo-export-root-session-id")).toBe("s1")
    expect(headers.get("x-kilo-export-session-id")).toBe("s1")
    expect(headers.get("x-kilo-export-seq-start")).toBe("0")
    expect(headers.get("x-kilo-export-seq-end")).toBe("0")
    expect(headers.get("x-kilo-export-event-count")).toBe("1")
    expect(headers.get("x-kilo-export-content-encoding")).toBe("identity")
    expect(headers.get("x-kilo-export-client-sent-at")).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(headers.get("x-kilo-export-payload-sha256")).toBe(await sha256(body))
    expect(headers.get("authorization")).toBe("Bearer local-token")
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 }).length).toBe(0)
    expect(telemetry.some((item) => (item as { name?: string }).name === "session_export.uploaded")).toBe(true)
  })

  test("uploads one session per batch so key metadata can reconstruct sessions", async () => {
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s2",
      rootSessionId: "s2",
      seq: 1,
      type: "llm_request_started",
      ts: 101,
      agentVersion: "v0",
      dataJson: "{}",
      clientScrubbed: 1,
    })
    const bodies: string[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (_input, init) => {
        bodies.push(init.body as string)
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })
    await uploader.flush("test")
    const first = JSON.parse(bodies[0]) as { events: Array<{ sessionId: string }> }
    const second = JSON.parse(bodies[1]) as { events: Array<{ sessionId: string }> }
    expect(first.events.map((event) => event.sessionId)).toEqual(["s1"])
    expect(second.events.map((event) => event.sessionId)).toEqual(["s2"])
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 })).toEqual([])
  })

  test("concurrent shutdown flush waits for active upload", async () => {
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => {
        await blocked
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })
    const first = uploader.flush("scheduled")
    let done = false
    const second = uploader.flush("shutdown").then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    release?.()
    await Promise.all([first, second])
    expect(done).toBe(true)
  })

  test("includes surface in batch metadata and upload headers", async () => {
    const calls: Array<{ init: RequestInit }> = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (_input, init) => {
        calls.push({ init })
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "vscode-extension",
    })
    await uploader.flush("test")
    const headers = new Headers(calls[0].init.headers)
    const body = JSON.parse(calls[0].init.body as string) as { surface?: string }
    expect(headers.get("x-kilo-export-surface")).toBe("vscode-extension")
    expect(body.surface).toBe("vscode-extension")
  })

  test("uploads chunks as zstd base64 strings", async () => {
    storage.upsertChunk({ id: "h1", bytes: new Uint8Array([1, 2, 3, 4]), size: 10, encoding: "zstd" })
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 1,
      type: "llm_request_completed",
      ts: 101,
      agentVersion: "v0",
      dataJson: '{"output":{"textParts":[{"__chunked":true,"chunkIds":["h1"],"size":10,"encoding":"utf8"}]}}',
      clientScrubbed: 1,
    })
    const bodies: string[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (_input, init) => {
        bodies.push(init.body as string)
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })
    await uploader.flush("test")
    const body = JSON.parse(bodies[0]) as { chunks: Array<{ id: string; bytes: unknown; size: number; encoding: string }> }
    expect(body.chunks).toEqual([{ id: "h1", bytes: "AQIDBA==", size: 10, encoding: "zstd+base64" }])
  })

  test("4xx response drops rows without retry", async () => {
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => new Response("", { status: 400 }),
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
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
      surface: "test",
    })
    await uploader.flush("test")
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 }).length).toBe(0)
  })
})

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
