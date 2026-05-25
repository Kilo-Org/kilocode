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
    })
    await uploader.flush("test")
    const first = JSON.parse(bodies[0]) as { events: Array<{ sessionId: string }> }
    const second = JSON.parse(bodies[1]) as { events: Array<{ sessionId: string }> }
    expect(first.events.map((event) => event.sessionId)).toEqual(["s1"])
    expect(second.events.map((event) => event.sessionId)).toEqual(["s2"])
    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 })).toEqual([])
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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
