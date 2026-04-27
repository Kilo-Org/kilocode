/**
 * Tests for routing-webview.ts (real-backend wiring).
 */

import { handleRoutingRealWebviewMessage } from "../routing-webview"

function makeCtx() {
  const posted: unknown[] = []
  const secrets = {
    store: new Map<string, string>(),
    async get(k: string) {
      return this.store.get(k)
    },
  }
  const extensionContext = { secrets } as unknown as import("vscode").ExtensionContext
  return {
    posted,
    ctx: { extensionContext, postMessage: (m: unknown) => posted.push(m) },
  }
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): jest.Mock {
  const fn = jest.fn(impl) as unknown as jest.Mock
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch
  return fn
}

describe("handleRoutingRealWebviewMessage", () => {
  afterEach(() => jest.resetAllMocks())

  it("ignores non-routing messages", async () => {
    const { ctx } = makeCtx()
    expect(await handleRoutingRealWebviewMessage({ type: "memory.list" }, ctx)).toBe(false)
  })

  it("listModels GETs /api/litellm/models and unpacks `data` shape", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "claude-3-5-sonnet", provider: "anthropic", context_window: 200000 },
            { id: "gpt-4o", provider: "openai", context_window: 128000 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await handleRoutingRealWebviewMessage({ type: "routing.listModels" }, ctx)

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/litellm\/models$/)
    const out = posted[0] as { type: string; payload: { kind: string; models: unknown[] } }
    expect(out.type).toBe("routing.update")
    expect(out.payload.kind).toBe("models")
    expect(out.payload.models).toHaveLength(2)
  })

  it("listModels also accepts `models` shape", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () =>
      new Response(JSON.stringify({ models: [{ id: "x", provider: "y" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await handleRoutingRealWebviewMessage({ type: "routing.listModels" }, ctx)
    const out = posted[0] as { payload: { models: unknown[] } }
    expect(out.payload.models).toHaveLength(1)
  })

  it("route POSTs /api/litellm/route with task and optional model", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(
        JSON.stringify({ selected: "claude-3-5-sonnet", reason: "best for code", estimated_cost_usd: 0.05 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await handleRoutingRealWebviewMessage(
      { type: "routing.route", task: "write a sorting algo", model: "claude-3-5-sonnet" },
      ctx,
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/litellm\/route$/)
    expect((init as RequestInit).method).toBe("POST")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ task: "write a sorting algo", model: "claude-3-5-sonnet" })

    const out = posted[0] as { payload: { kind: string; response: { selected: string } } }
    expect(out.payload.kind).toBe("route")
    expect(out.payload.response.selected).toBe("claude-3-5-sonnet")
  })

  it("rejects route without task", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("{}", { status: 200 }))
    await handleRoutingRealWebviewMessage({ type: "routing.route", task: "" }, ctx)
    const out = posted[0] as { payload: { error?: string } }
    expect(out.payload.error).toMatch(/task is required/)
  })

  it("surfaces fetch errors", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("err", { status: 503 }))
    await handleRoutingRealWebviewMessage({ type: "routing.listModels" }, ctx)
    const out = posted[0] as { payload: { error?: string } }
    expect(out.payload.error).toMatch(/HTTP 503/)
  })
})
