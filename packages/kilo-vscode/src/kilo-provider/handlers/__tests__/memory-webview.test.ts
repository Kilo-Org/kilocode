/**
 * Tests for memory-webview.ts (real-backend wiring + Hub URL resolution).
 *
 * Covers:
 *   • Legacy unprefixed handler (`handleMemoryWebviewMessage`)
 *   • New `memory.*` prefixed handler (`handleMemoryRealWebviewMessage`)
 *   • URL resolution precedence:
 *       kilocode.updates.hubBaseUrl  (primary)
 *       daveai.hub.baseUrl           (fallback)
 *       https://hermes.daveai.tech   (default)
 *   • Bearer token wiring from SecretStorage
 *   • 404 graceful degradation ("no entries yet" + lastError)
 *
 * Test runner: bun:test (project default — see bunfig.toml).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import {
  handleMemoryWebviewMessage,
  handleMemoryRealWebviewMessage,
  resolveHubBaseUrl,
  HUB_BASE_URL_DEFAULT,
} from "../memory-webview"

// ─── vscode mock plumbing ────────────────────────────────────────────────

interface ConfigStore {
  [section: string]: { [key: string]: string | undefined }
}

const configStore: ConfigStore = {}

function setConfig(dotted: string, value: string | undefined): void {
  const lastDot = dotted.lastIndexOf(".")
  const section = lastDot < 0 ? "" : dotted.slice(0, lastDot)
  const property = lastDot < 0 ? dotted : dotted.slice(lastDot + 1)
  configStore[section] ??= {}
  if (value === undefined) {
    delete configStore[section][property]
  } else {
    configStore[section][property] = value
  }
}

function clearConfig(): void {
  for (const k of Object.keys(configStore)) delete configStore[k]
}

// Override the shared vscode mock's getConfiguration so resolveHubBaseUrl
// can read our test-controlled values.
mock.module("vscode", () => ({
  workspace: {
    getConfiguration: (section?: string) => ({
      get: <T,>(key: string, fallback?: T): T | undefined => {
        const bag = configStore[section ?? ""] ?? {}
        const v = bag[key]
        return (v ?? fallback) as T | undefined
      },
      update: async () => {},
    }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}))

// ─── ctx + fetch helpers ─────────────────────────────────────────────────

function makeCtx(token?: string) {
  const posted: unknown[] = []
  const secrets = {
    store: new Map<string, string>(),
    async get(k: string) {
      return this.store.get(k)
    },
    async storeSecret(k: string, v: string) {
      this.store.set(k, v)
    },
    async delete(k: string) {
      this.store.delete(k)
    },
  }
  if (token) secrets.store.set("kilo-code.new.hub.adminToken", token)
  const extensionContext = { secrets } as unknown as import("vscode").ExtensionContext
  return {
    posted,
    ctx: { extensionContext, postMessage: (m: unknown) => posted.push(m) },
    secrets,
  }
}

interface FetchCall {
  url: string
  init?: RequestInit
}

function installFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as { url: string }).url
    calls.push({ url, init })
    return await responder(url, init)
  }
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch
  return { calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("resolveHubBaseUrl precedence", () => {
  beforeEach(() => clearConfig())
  afterEach(() => clearConfig())

  it("uses kilocode.updates.hubBaseUrl when set (primary)", () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://my-hub.example/")
    expect(resolveHubBaseUrl()).toBe("https://my-hub.example")
  })

  it("falls back to daveai.hub.baseUrl when only it is set", () => {
    setConfig("daveai.hub.baseUrl", "https://old.example/")
    expect(resolveHubBaseUrl()).toBe("https://old.example")
  })

  it("defaults to https://hermes.daveai.tech when neither is set", () => {
    expect(resolveHubBaseUrl()).toBe(HUB_BASE_URL_DEFAULT)
  })

  it("primary wins over fallback when both are set", () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://primary.example")
    setConfig("daveai.hub.baseUrl", "https://fallback.example")
    expect(resolveHubBaseUrl()).toBe("https://primary.example")
  })

  it("ignores empty / whitespace-only config values", () => {
    setConfig("kilocode.updates.hubBaseUrl", "   ")
    setConfig("daveai.hub.baseUrl", "https://fallback.example")
    expect(resolveHubBaseUrl()).toBe("https://fallback.example")
  })
})

describe("handleMemoryWebviewMessage (legacy contract)", () => {
  beforeEach(() => clearConfig())
  afterEach(() => clearConfig())

  it("does not handle non-memory messages", async () => {
    installFetch(() => jsonResponse({}))
    const { ctx } = makeCtx()
    expect(await handleMemoryWebviewMessage({ type: "hermes.route" }, ctx)).toBe(false)
  })

  it("memoryGetStatus uses configured primary Hub URL with bearer", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://my-hub.example/")
    const { ctx, posted } = makeCtx("admin-token-123")
    const { calls } = installFetch(() =>
      jsonResponse({ connection: { status: "connected", endpoint: "shiba" }, entryCount: 7 }),
    )

    await handleMemoryWebviewMessage({ type: "memoryGetStatus" }, ctx)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://my-hub.example/api/shiba/status")
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer admin-token-123")

    const out = posted[0] as { type: string; entryCount: number }
    expect(out.type).toBe("memoryStatusLoaded")
    expect(out.entryCount).toBe(7)
  })

  it("memoryGetStatus falls back to daveai.hub.baseUrl when primary not set", async () => {
    setConfig("daveai.hub.baseUrl", "https://old.example/")
    const { ctx } = makeCtx()
    const { calls } = installFetch(() => jsonResponse({ connection: {} }))

    await handleMemoryWebviewMessage({ type: "memoryGetStatus" }, ctx)

    expect(calls[0].url).toBe("https://old.example/api/shiba/status")
  })

  it("memoryGetStatus uses default Hub URL when no config set", async () => {
    const { ctx } = makeCtx()
    const { calls } = installFetch(() => jsonResponse({ connection: {} }))

    await handleMemoryWebviewMessage({ type: "memoryGetStatus" }, ctx)

    expect(calls[0].url).toBe("https://hermes.daveai.tech/api/shiba/status")
  })

  it("memoryGetHistory POSTs /api/shiba/list and surfaces records", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://h.example")
    const { ctx, posted } = makeCtx("tk")
    const { calls } = installFetch(() =>
      jsonResponse({ records: [{ entryId: "e1", summary: "x", factType: "fix", project: "p", scope: "project", traceRef: "t", timestamp: 1 }] }),
    )

    await handleMemoryWebviewMessage({ type: "memoryGetHistory", project: "p" }, ctx)

    expect(calls[0].url).toBe("https://h.example/api/shiba/list")
    expect(calls[0].init?.method).toBe("POST")
    const out = posted[0] as { type: string; records: unknown[] }
    expect(out.type).toBe("memoryHistoryLoaded")
    expect(out.records).toHaveLength(1)
  })

  it("memoryGetHistory handles 404 gracefully (no entries yet + lastError)", async () => {
    const { ctx, posted } = makeCtx()
    installFetch(() => new Response("not found", { status: 404 }))

    await handleMemoryWebviewMessage({ type: "memoryGetHistory" }, ctx)

    const out = posted[0] as { records: unknown[]; lastError: string }
    expect(out.records).toEqual([])
    expect(out.lastError).toMatch(/Hub does not expose/i)
  })

  it("memoryGetStatus on 404 emits empty status with lastError, not red error", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://h.example")
    const { ctx, posted } = makeCtx()
    installFetch(() => new Response("nope", { status: 404 }))

    await handleMemoryWebviewMessage({ type: "memoryGetStatus" }, ctx)

    const out = posted[0] as {
      connection: { endpoint: string; status: string; lastError: string }
      health: { status: string }
    }
    expect(out.connection.endpoint).toBe("https://h.example")
    expect(out.connection.lastError).toMatch(/upgrade DaveAI Hub/i)
    expect(out.health.status).toBe("unavailable")
  })

  it("memoryRecall POSTs /api/shiba/recall with query+project and bearer", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://h.example")
    const { ctx, posted } = makeCtx("tk")
    const { calls } = installFetch(() =>
      jsonResponse({
        query: "auth bug",
        project: "current",
        status: "success",
        results: [{ id: "m1", relevanceScore: 0.9, matchReason: "exact" }],
        timestamp: 1,
      }),
    )

    await handleMemoryWebviewMessage(
      { type: "memoryRecall", query: "auth bug", project: "current" },
      ctx,
    )

    expect(calls[0].url).toBe("https://h.example/api/shiba/recall")
    expect(calls[0].init?.method).toBe("POST")
    const body = JSON.parse(calls[0].init?.body as string)
    expect(body).toEqual({ query: "auth bug", project: "current" })
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tk")

    const out = posted[0] as { type: string; status: string; results: unknown[] }
    expect(out.type).toBe("memoryRecallResult")
    expect(out.status).toBe("success")
    expect(out.results).toHaveLength(1)
  })

  it("memoryRecall on 404 returns empty results with lastError", async () => {
    const { ctx, posted } = makeCtx()
    installFetch(() => new Response("nope", { status: 404 }))

    await handleMemoryWebviewMessage(
      { type: "memoryRecall", query: "auth bug" },
      ctx,
    )

    const out = posted[0] as { status: string; results: unknown[]; lastError: string }
    expect(out.status).toBe("empty")
    expect(out.results).toEqual([])
    expect(out.lastError).toMatch(/Hub does not expose/i)
  })

  it("omits Authorization header when no bearer token is configured", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://h.example")
    const { ctx } = makeCtx() // no token
    const { calls } = installFetch(() => jsonResponse({}))

    await handleMemoryWebviewMessage({ type: "memoryGetStatus" }, ctx)

    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })
})

describe("handleMemoryRealWebviewMessage (memory.* prefixed contract)", () => {
  beforeEach(() => clearConfig())
  afterEach(() => clearConfig())

  it("ignores non-memory.* messages", async () => {
    installFetch(() => jsonResponse({}))
    const { ctx } = makeCtx()
    expect(await handleMemoryRealWebviewMessage({ type: "hermes.route" }, ctx)).toBe(false)
  })

  it("memory.list GETs /api/shiba/memories and posts memory.update", async () => {
    setConfig("kilocode.updates.hubBaseUrl", "https://h.example")
    const { ctx, posted } = makeCtx()
    const { calls } = installFetch(() =>
      jsonResponse({
        memories: [
          { id: "m1", project: "p", scope: "project", factType: "fix", summary: "x", content: "x", traceRef: "t", timestamp: 1 },
        ],
        entryCount: 1,
      }),
    )

    await handleMemoryRealWebviewMessage({ type: "memory.list" }, ctx)

    expect(calls[0].url).toBe("https://h.example/api/shiba/memories")
    const out = posted[0] as {
      type: string
      payload: { kind: string; memories: unknown[]; entryCount: number }
    }
    expect(out.type).toBe("memory.update")
    expect(out.payload.kind).toBe("list")
    expect(out.payload.entryCount).toBe(1)
    expect(out.payload.memories).toHaveLength(1)
  })

  it("memory.list on 404 surfaces 'no entries yet' + error string", async () => {
    const { ctx, posted } = makeCtx()
    installFetch(() => new Response("nope", { status: 404 }))

    await handleMemoryRealWebviewMessage({ type: "memory.list" }, ctx)

    const out = posted[0] as { payload: { memories: unknown[]; error: string } }
    expect(out.payload.memories).toEqual([])
    expect(out.payload.error).toMatch(/Hub does not expose/i)
  })

  it("memory.recall rejects empty query without hitting the network", async () => {
    const { ctx, posted } = makeCtx()
    const { calls } = installFetch(() => jsonResponse({}))

    await handleMemoryRealWebviewMessage({ type: "memory.recall", query: "  " }, ctx)

    expect(calls).toHaveLength(0)
    const out = posted[0] as { payload: { error?: string; status: string } }
    expect(out.payload.error).toMatch(/query is required/)
    expect(out.payload.status).toBe("failed")
  })

  it("memory.recall surfaces transport failures", async () => {
    const { ctx, posted } = makeCtx()
    installFetch(() => new Response("server exploded", { status: 500 }))

    await handleMemoryRealWebviewMessage(
      { type: "memory.recall", query: "anything" },
      ctx,
    )

    const out = posted[0] as { payload: { status: string; error?: string } }
    expect(out.payload.status).toBe("failed")
    expect(out.payload.error).toMatch(/HTTP 500/)
  })
})
