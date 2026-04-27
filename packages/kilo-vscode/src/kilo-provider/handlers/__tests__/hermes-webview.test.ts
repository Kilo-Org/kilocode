/**
 * Tests for hermes-webview.ts (real-backend wiring).
 *
 * Test plan:
 *   1. listAgents → GET https://hermes.daveai.tech/hermes/agents → posts hermes.update {agents}
 *   2. route → POST https://hermes.daveai.tech/hermes/route with task → posts hermes.update {response}
 *   3. fetch failure surfaces in payload.error
 *   4. Bearer header attached when SecretStorage has a key
 */

import { handleHermesRealWebviewMessage } from "../hermes-webview"

interface FakeSecrets {
  store: Map<string, string>
  get(key: string): Promise<string | undefined>
  store_(key: string, value: string): Promise<void>
}

function makeCtx() {
  const posted: unknown[] = []
  const secrets: FakeSecrets = {
    store: new Map(),
    async get(k) {
      return secrets.store.get(k)
    },
    async store_(k, v) {
      secrets.store.set(k, v)
    },
  }
  const extensionContext = { secrets } as unknown as import("vscode").ExtensionContext
  return {
    posted,
    ctx: { extensionContext, postMessage: (m: unknown) => posted.push(m) },
    secrets,
  }
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): jest.Mock {
  const fn = jest.fn(impl) as unknown as jest.Mock
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch
  return fn
}

describe("handleHermesRealWebviewMessage", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("ignores non-hermes messages", async () => {
    const { ctx } = makeCtx()
    const handled = await handleHermesRealWebviewMessage({ type: "speech.test" }, ctx)
    expect(handled).toBe(false)
  })

  it("listAgents calls /hermes/agents and posts hermes.update", async () => {
    const { ctx, posted, secrets } = makeCtx()
    await secrets.store_("kilo-code.new.hermes.apiKey", "sk-test-123")
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ agents: [{ id: "researcher", name: "Researcher" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const handled = await handleHermesRealWebviewMessage({ type: "hermes.listAgents" }, ctx)
    expect(handled).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/hermes\/agents$/)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test-123" })

    expect(posted).toHaveLength(1)
    const out = posted[0] as { type: string; payload: { kind: string; agents: unknown[] } }
    expect(out.type).toBe("hermes.update")
    expect(out.payload.kind).toBe("agents")
    expect(out.payload.agents).toHaveLength(1)
  })

  it("route POSTs /hermes/route with the task body and surfaces response", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ agent: "researcher", output: "done", cost_usd: 0.01 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await handleHermesRealWebviewMessage(
      { type: "hermes.route", task: "audit providers", agent: "researcher" },
      ctx,
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/hermes\/route$/)
    expect((init as RequestInit).method).toBe("POST")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ task: "audit providers", agent: "researcher" })

    const out = posted[0] as { payload: { kind: string; response: { agent: string } } }
    expect(out.payload.kind).toBe("route")
    expect(out.payload.response.agent).toBe("researcher")
  })

  it("surfaces fetch errors via payload.error", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("boom", { status: 502 }))

    await handleHermesRealWebviewMessage({ type: "hermes.listAgents" }, ctx)

    const out = posted[0] as { payload: { error?: string; agents: unknown[] } }
    expect(out.payload.agents).toEqual([])
    expect(out.payload.error).toMatch(/HTTP 502/)
  })

  it("rejects route without task", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("{}", { status: 200 }))

    await handleHermesRealWebviewMessage({ type: "hermes.route", task: "" }, ctx)

    const out = posted[0] as { payload: { error?: string } }
    expect(out.payload.error).toMatch(/task is required/)
  })
})
