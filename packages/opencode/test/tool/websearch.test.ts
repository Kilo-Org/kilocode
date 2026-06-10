import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { call, parseResponse } from "../../src/tool/mcp-websearch"
import { DEFAULT_HEADERS } from "../../src/kilocode/const"
import { selectWebSearchProvider, webSearchModelName, webSearchProviderLabel } from "../../src/tool/websearch"
import { ProviderID } from "../../src/provider/schema"
import { webSearchEnabled } from "../../src/tool/registry"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

describe("websearch provider", () => {
  test("selects a stable provider per session", () => {
    expect(selectWebSearchProvider(SESSION_ID)).toBe(selectWebSearchProvider(SESSION_ID))
  })

  test("supports an operational override", () => {
    const original = process.env.KILO_WEBSEARCH_PROVIDER

    try {
      process.env.KILO_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.KILO_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.KILO_WEBSEARCH_PROVIDER
      else process.env.KILO_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: true, parallel: false })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: false, parallel: true })).toBe("parallel")
  })

  test("defaults to Exa when no provider is pinned", () => {
    const original = process.env.KILO_WEBSEARCH_PROVIDER

    try {
      delete process.env.KILO_WEBSEARCH_PROVIDER
      expect(selectWebSearchProvider(SESSION_ID, { exa: false, parallel: false })).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.KILO_WEBSEARCH_PROVIDER
      else process.env.KILO_WEBSEARCH_PROVIDER = original
    }
  })

  test("is only enabled for kilo or explicit websearch provider flags", () => {
    // kilocode_change
    expect(webSearchEnabled(ProviderID.kilo, { exa: false, parallel: false })).toBe(true) // kilocode_change
    expect(webSearchEnabled(ProviderID.opencode, { exa: false, parallel: false })).toBe(false) // kilocode_change
    expect(webSearchEnabled(ProviderID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderID.openai, { exa: false, parallel: true })).toBe(true)
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for Parallel analytics", () => {
    expect(
      webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })
})

describe("mcp-websearch headers", () => {
  const Args = Schema.Struct({ query: Schema.String })

  const okBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "ok" }] },
  })

  async function withServer(
    handler: (req: Request) => Response | Promise<Response>,
    fn: (url: string) => Promise<void>,
  ) {
    const server = Bun.serve({ port: 0, fetch: handler })
    try {
      await fn(server.url.toString())
    } finally {
      server.stop()
    }
  }

  function runCall(url: string, extraHeaders?: Record<string, string>) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        return yield* call(http, url, "web_search_exa", Args, { query: "test" }, "5 seconds", extraHeaders)
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
  }

  test("Exa call includes Kilo-Code User-Agent", async () => {
    let captured: Headers | undefined
    await withServer(
      (req) => {
        captured = req.headers
        return new Response(okBody, { status: 200 })
      },
      async (url) => {
        await runCall(url)
        expect(captured?.get("user-agent")).toBe(DEFAULT_HEADERS["User-Agent"])
      },
    )
  })

  test("Exa call includes HTTP-Referer and X-Title", async () => {
    let captured: Headers | undefined
    await withServer(
      (req) => {
        captured = req.headers
        return new Response(okBody, { status: 200 })
      },
      async (url) => {
        await runCall(url)
        expect(captured?.get("http-referer")).toBe(DEFAULT_HEADERS["HTTP-Referer"])
        expect(captured?.get("x-title")).toBe(DEFAULT_HEADERS["X-Title"])
      },
    )
  })

  test("caller-supplied headers override DEFAULT_HEADERS", async () => {
    let captured: Headers | undefined
    await withServer(
      (req) => {
        captured = req.headers
        return new Response(okBody, { status: 200 })
      },
      async (url) => {
        await runCall(url, { "User-Agent": "opencode/0.0.0", Authorization: "Bearer tok" })
        expect(captured?.get("user-agent")).toBe("opencode/0.0.0")
        expect(captured?.get("authorization")).toBe("Bearer tok")
        // Base headers still present
        expect(captured?.get("http-referer")).toBe(DEFAULT_HEADERS["HTTP-Referer"])
      },
    )
  })
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  test("parses plain JSON-RPC responses", async () => {
    await expect(Effect.runPromise(parseResponse(payload))).resolves.toBe("search results")
  })

  test("parses SSE JSON-RPC responses", async () => {
    await expect(Effect.runPromise(parseResponse(`event: message\ndata: ${payload}\n\n`))).resolves.toBe(
      "search results",
    )
  })

  test("ignores non-JSON SSE data frames", async () => {
    await expect(Effect.runPromise(parseResponse(`data: [DONE]\ndata: ${payload}\n\n`))).resolves.toBe("search results")
  })
})
