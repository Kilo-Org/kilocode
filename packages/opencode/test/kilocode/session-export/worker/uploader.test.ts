import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Uploader, backoffFor } from "@/kilocode/session-export/worker/uploader"
import { Config } from "@/kilocode/session-export/config"

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

  test("flushes pending rows on startup", async () => {
    const calls: RequestInit[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (_input, init) => {
        calls.push(init)
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })

    await waitFor(() => calls.length > 0)
    uploader.dispose()

    expect(storage.pendingEvents({ now: Date.now(), limitBytes: 1_000_000 })).toEqual([])
  })

  test("sends anonymous id with all export headers when auth token is absent", async () => {
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
      surface: "test",
      anonId: "install_abc",
    })
    await uploader.flush("test")
    const headers = new Headers(calls[0].init.headers)
    const names = [
      "x-kilo-export-api-version",
      "x-kilo-export-schema-version",
      "x-kilo-export-agent-version",
      "x-kilo-export-surface",
      "x-kilo-export-root-session-id",
      "x-kilo-export-session-id",
      "x-kilo-export-batch-id",
      "x-kilo-export-seq-start",
      "x-kilo-export-seq-end",
      "x-kilo-export-event-count",
      "x-kilo-export-payload-sha256",
      "x-kilo-export-client-sent-at",
      "x-kilo-export-content-encoding",
    ]

    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-kilo-anon-id")).toBe("install_abc")
    for (const name of names) expect(headers.get(name)).toBeTruthy()
  })

  test("falls back to telemetry id when anon id is not provided", async () => {
    const calls: Array<{ init: RequestInit }> = []
    writeFileSync(join(dir, "telemetry-id"), "install_from_disk")
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async (_input, init) => {
        calls.push({ init })
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
      anonIdPath: join(dir, "telemetry-id"),
    })

    await uploader.flush("test")

    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-kilo-anon-id")).toBe("install_from_disk")
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

  test("restores parent session id into uploaded event envelopes", async () => {
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "child",
      rootSessionId: "root",
      parentSessionId: "root",
      seq: 0,
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

    const child = bodies
      .map((body) => JSON.parse(body) as { events: Array<{ sessionId: string; parentSessionId?: string }> })
      .flatMap((body) => body.events)
      .find((event) => event.sessionId === "child")
    expect(child?.parentSessionId).toBe("root")
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

  test("deduplicates repeated request context into batch dictionaries", async () => {
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 1,
      type: "llm_request_started",
      ts: 101,
      agentVersion: "v0",
      dataJson: JSON.stringify({
        requestId: "r2",
        agentInfo: { name: "code" },
        input: {
          system: ["sys"],
          messages: [],
          tools: { bash: { description: "run" } },
          permissions: [{ permission: "*", pattern: "*", action: "allow" }],
          params: {},
        },
      }),
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
    const body = JSON.parse(bodies[0]) as {
      events: Array<{ requestId?: string; input?: Record<string, unknown>; agentInfo?: unknown; agentRef?: string }>
      systemPrompts?: Record<string, unknown>
      toolSchemas?: Record<string, unknown>
      permissionSets?: Record<string, unknown>
      agents?: Record<string, unknown>
    }
    const event = body.events.find((item) => item.requestId === "r2")
    const input = event?.input
    expect(input?.system).toBeUndefined()
    expect(input?.tools).toBeUndefined()
    expect(input?.permissions).toBeUndefined()
    expect(event?.agentInfo).toBeUndefined()
    expect(body.systemPrompts?.[input?.systemRef as string]).toEqual(["sys"])
    expect(body.toolSchemas?.[input?.toolSchemaRef as string]).toEqual({ bash: { description: "run" } })
    expect(body.permissionSets?.[input?.permissionRef as string]).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
    ])
    expect(body.agents?.[event?.agentRef as string]).toEqual({ name: "code" })
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
    const body = JSON.parse(bodies[0]) as {
      chunks: Array<{ id: string; bytes: unknown; size: number; encoding: string }>
    }
    expect(body.chunks).toEqual([{ id: "h1", bytes: "AQIDBA==", size: 10, encoding: "zstd+base64" }])
    expect(storage.getChunk("h1")).toBeUndefined()
  })

  test("terminal 4xx response drops rows without retry", async () => {
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
    const afterRetryWindow = Date.now() + Config.retryBackoffMaxMs + 1
    expect(storage.pendingEvents({ now: afterRetryWindow, limitBytes: 1_000_000 }).length).toBe(0)
  })

  test("429 response retries rows after retry-after", async () => {
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })
    const start = Date.now()
    await uploader.flush("test")
    expect(storage.pendingEvents({ now: start + 1_500, limitBytes: 1_000_000 }).length).toBe(0)
    expect(storage.pendingEvents({ now: start + 2_500, limitBytes: 1_000_000 }).length).toBe(1)
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

  test("does not combine retried rows across uploaded sequence gaps", async () => {
    storage.markRetry("01", Date.now() + 60_000)
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 1,
      type: "workspace_baseline_completed",
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
    storage.markRetry("01", Date.now() - 1)
    storage.insertEvent({
      id: "03",
      schemaVersion: 1,
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 2,
      type: "tool_executed",
      ts: 102,
      agentVersion: "v0",
      dataJson: "{}",
      clientScrubbed: 1,
    })

    await uploader.flush("test")

    const seqs = bodies.map((body) =>
      (JSON.parse(body) as { events: Array<{ seq: number }> }).events.map((event) => event.seq),
    )
    expect(seqs).toEqual([[1], [0], [2]])
  })

  test("paces upload requests at the configured rate limit", async () => {
    storage.insertEvent({
      id: "02",
      schemaVersion: 1,
      sessionId: "s2",
      rootSessionId: "s2",
      seq: 0,
      type: "llm_request_started",
      ts: 101,
      agentVersion: "v0",
      dataJson: "{}",
      clientScrubbed: 1,
    })
    storage.insertEvent({
      id: "03",
      schemaVersion: 1,
      sessionId: "s3",
      rootSessionId: "s3",
      seq: 0,
      type: "llm_request_started",
      ts: 102,
      agentVersion: "v0",
      dataJson: "{}",
      clientScrubbed: 1,
    })
    const clock = { now: 1_000 }
    const calls: number[] = []
    const waits: number[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => {
        calls.push(clock.now)
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
      now: () => clock.now,
      sleep: async (ms) => {
        waits.push(ms)
        clock.now += ms
      },
    })

    await uploader.flush("test")

    expect(calls).toEqual([
      1_000,
      1_000 + Config.uploadRateLimitIntervalMs,
      1_000 + Config.uploadRateLimitIntervalMs * 2,
    ])
    expect(waits).toEqual([Config.uploadRateLimitIntervalMs, Config.uploadRateLimitIntervalMs])
  })

  test("backoffFor grows exponentially and caps at retryBackoffMaxMs", () => {
    expect(backoffFor(0)).toBe(Config.retryBackoffMinMs)
    expect(backoffFor(1)).toBe(Config.retryBackoffMinMs * 2)
    expect(backoffFor(2)).toBe(Config.retryBackoffMinMs * 4)
    expect(backoffFor(20)).toBe(Config.retryBackoffMaxMs)
  })

  test("dispose stops the periodic flush timer", async () => {
    const calls: number[] = []
    const uploader = new Uploader({
      storage,
      endpoint: "https://example.test/ingest",
      fetch: async () => {
        calls.push(1)
        return new Response("", { status: 204 })
      },
      reportTelemetry: () => {},
      agentVersion: "v0",
      surface: "test",
    })
    uploader.dispose()
    expect(calls.length).toBe(0)
  })
})

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 1_000) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for condition")
}
