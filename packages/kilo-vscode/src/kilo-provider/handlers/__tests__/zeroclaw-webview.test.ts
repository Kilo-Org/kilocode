/**
 * Tests for zeroclaw-webview.ts (real-backend wiring).
 */

import { handleZeroClawRealWebviewMessage } from "../zeroclaw-webview"

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

describe("handleZeroClawRealWebviewMessage", () => {
  afterEach(() => jest.resetAllMocks())

  it("ignores non-zeroclaw messages", async () => {
    const { ctx } = makeCtx()
    expect(await handleZeroClawRealWebviewMessage({ type: "routing.route" }, ctx)).toBe(false)
  })

  it("queue GETs /zeroclaw/queue and posts zeroclaw.update", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(
        JSON.stringify({
          queue: [
            {
              task_id: "abc-123",
              description: "rm -rf /tmp/cache",
              risk_level: "high",
              project_path: "/srv/app",
              requested_at: 1700000000,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await handleZeroClawRealWebviewMessage({ type: "zeroclaw.queue" }, ctx)

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/zeroclaw\/queue$/)
    const out = posted[0] as { type: string; payload: { kind: string; queue: unknown[] } }
    expect(out.type).toBe("zeroclaw.update")
    expect(out.payload.kind).toBe("queue")
    expect(out.payload.queue).toHaveLength(1)
  })

  it("approve POSTs /zeroclaw/approve with task_id+approver", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, task_id: "abc-123", status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await handleZeroClawRealWebviewMessage(
      { type: "zeroclaw.approve", task_id: "abc-123", approver: "alice" },
      ctx,
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/zeroclaw\/approve$/)
    expect((init as RequestInit).method).toBe("POST")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ task_id: "abc-123", approver: "alice" })

    const out = posted[0] as { payload: { kind: string; task_id: string; response: { status: string } } }
    expect(out.payload.kind).toBe("approve")
    expect(out.payload.task_id).toBe("abc-123")
    expect(out.payload.response.status).toBe("approved")
  })

  it("reject POSTs /zeroclaw/reject with task_id+reason", async () => {
    const { ctx, posted } = makeCtx()
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, task_id: "abc-123", status: "rejected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await handleZeroClawRealWebviewMessage(
      { type: "zeroclaw.reject", task_id: "abc-123", reason: "too risky" },
      ctx,
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/zeroclaw\/reject$/)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ task_id: "abc-123", reason: "too risky" })

    const out = posted[0] as { payload: { kind: string; response: { status: string } } }
    expect(out.payload.kind).toBe("reject")
    expect(out.payload.response.status).toBe("rejected")
  })

  it("rejects approve without task_id (camelCase taskId also accepted)", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("{}", { status: 200 }))
    await handleZeroClawRealWebviewMessage({ type: "zeroclaw.approve" }, ctx)
    const out = posted[0] as { payload: { error?: string } }
    expect(out.payload.error).toMatch(/task_id is required/)
  })

  it("approve accepts camelCase taskId from existing UI", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, task_id: "x", status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await handleZeroClawRealWebviewMessage({ type: "zeroclaw.approve", taskId: "x" }, ctx)
    const out = posted[0] as { payload: { error?: string; task_id?: string } }
    expect(out.payload.error).toBeUndefined()
    expect(out.payload.task_id).toBe("x")
  })

  it("surfaces fetch errors", async () => {
    const { ctx, posted } = makeCtx()
    mockFetch(async () => new Response("denied", { status: 403 }))
    await handleZeroClawRealWebviewMessage({ type: "zeroclaw.queue" }, ctx)
    const out = posted[0] as { payload: { error?: string; queue: unknown[] } }
    expect(out.payload.queue).toEqual([])
    expect(out.payload.error).toMatch(/HTTP 403/)
  })
})
