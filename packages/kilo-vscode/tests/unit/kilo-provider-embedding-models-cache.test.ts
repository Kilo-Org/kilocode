/**
 * Regression: KiloProvider used to cache and post any catalog returned by the
 * gateway, including the empty fallback that `fetchKiloEmbeddingModelCatalog`
 * returns on transient failures. That poisoned the cache so subsequent
 * `requestKiloEmbeddingModels` calls replayed the empty payload and
 * IndexingTab kept showing the literal "provider/model" placeholder until a
 * full webview reload.
 *
 * The fix:
 *   - Never cache an empty catalog.
 *   - When a non-empty catalog is already cached, replay it before re-fetching
 *     so a transient failure cannot regress the UI.
 */

import { describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  cachedKiloEmbeddingModelsMessage: unknown
  fetchAndSendKiloEmbeddingModels: () => Promise<void>
}

type Catalog = {
  defaultModel: string
  models: Array<{ id: string; name: string; dimension: number; scoreThreshold: number }>
  aliases: Record<string, string>
}

const REAL: Catalog = {
  defaultModel: "kilo/code-embedding-4k",
  models: [{ id: "kilo/code-embedding-4k", name: "Code Embedding 4k", dimension: 1024, scoreThreshold: 0.4 }],
  aliases: {},
}

const EMPTY: Catalog = { defaultModel: "", models: [], aliases: {} }

function createProvider() {
  const sent: Array<{ type: string; catalog?: Catalog }> = []
  const provider = new KiloProvider({} as never, {} as never)
  const internal = provider as unknown as Internals
  internal.webview = {
    postMessage: async (message) => {
      sent.push(message as { type: string; catalog?: Catalog })
      return true
    },
  }
  return { provider, internal, sent }
}

function mockGatewayFetch(responses: Array<Catalog | "fail">) {
  const original = globalThis.fetch
  let i = 0
  globalThis.fetch = (async () => {
    const next = responses[i++] ?? responses[responses.length - 1]
    if (next === "fail") return new Response("nope", { status: 500 })
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

describe("KiloProvider.fetchAndSendKiloEmbeddingModels", () => {
  it("caches a real catalog and posts it to the webview", async () => {
    const { internal, sent } = createProvider()
    const restore = mockGatewayFetch([REAL])
    try {
      await internal.fetchAndSendKiloEmbeddingModels()
    } finally {
      restore()
    }

    expect(sent.length).toBe(1)
    expect(sent[0]?.type).toBe("kiloEmbeddingModelsLoaded")
    expect(sent[0]?.catalog).toEqual(REAL)
    expect(internal.cachedKiloEmbeddingModelsMessage).toEqual({ type: "kiloEmbeddingModelsLoaded", catalog: REAL })
  })

  it("does NOT cache an empty catalog (transient failure must not poison the cache)", async () => {
    const { internal, sent } = createProvider()
    const restore = mockGatewayFetch(["fail"])
    try {
      await internal.fetchAndSendKiloEmbeddingModels()
    } finally {
      restore()
    }

    // Empty payload still posted so the webview can decide to retry.
    expect(sent.length).toBe(1)
    expect(sent[0]?.catalog).toEqual(EMPTY)
    // ...but the cache must stay null so the next request triggers a fresh
    // fetch instead of replaying the empty response.
    expect(internal.cachedKiloEmbeddingModelsMessage).toBeNull()
  })

  it("recovers on retry: empty fetch followed by a real fetch produces a cached real catalog", async () => {
    const { internal, sent } = createProvider()
    const restore = mockGatewayFetch(["fail", REAL])
    try {
      await internal.fetchAndSendKiloEmbeddingModels()
      await internal.fetchAndSendKiloEmbeddingModels()
    } finally {
      restore()
    }

    // First call posts empty; second call posts real.
    expect(sent.length).toBe(2)
    expect(sent[0]?.catalog).toEqual(EMPTY)
    expect(sent[1]?.catalog).toEqual(REAL)
    expect(internal.cachedKiloEmbeddingModelsMessage).toEqual({ type: "kiloEmbeddingModelsLoaded", catalog: REAL })
  })

  it("replays the cached real catalog before re-fetching, so a later transient failure cannot regress", async () => {
    const { internal, sent } = createProvider()
    const restore = mockGatewayFetch([REAL, "fail"])
    try {
      await internal.fetchAndSendKiloEmbeddingModels()
      sent.length = 0 // reset to inspect the second call only
      await internal.fetchAndSendKiloEmbeddingModels()
    } finally {
      restore()
    }

    // Second call: cached real catalog is replayed first. The fresh fetch
    // returns empty but must NOT be posted (would clobber the good catalog
    // in webview state) and must NOT overwrite the cache.
    expect(sent.length).toBe(1)
    expect(sent[0]?.catalog).toEqual(REAL)
    expect(internal.cachedKiloEmbeddingModelsMessage).toEqual({ type: "kiloEmbeddingModelsLoaded", catalog: REAL })
  })
})
