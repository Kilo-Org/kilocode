import { expect, test } from "bun:test"
import { KiloRunDrain } from "@/kilocode/cli/run-drain"
import { KiloRun } from "@/kilocode/cli/cmd/run"

function client(handle: (request: Request) => Promise<Response>) {
  return KiloRunDrain.client({
    baseUrl: "http://drain.test/prefix",
    headers: { Authorization: "Basic test-only" },
    fetch: Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        handle(input instanceof Request ? input : new Request(input, init)),
      { preconnect: () => {} },
    ),
  })
}

function event(token: string, sessionID = "ses_parent") {
  return { id: "evt_drain", type: "session.drained" as const, properties: { sessionID, token } }
}

test("checks capabilities through the selected transport before accepting completion", async () => {
  const sdk = client(async (request) => {
    expect(new URL(request.url).pathname).toBe("/prefix/doc")
    expect(request.headers.get("authorization")).toBe("Basic test-only")
    return Response.json({
      paths: { "/kilocode/session/{sessionID}/drain": { post: { operationId: "kilocode.drainSession" } } },
    })
  })
  await KiloRunDrain.check(sdk, new AbortController().signal)
})

test("scopes requests without losing the transport or cancellation signal", async () => {
  const abort = new AbortController()
  const paths: Array<string | null> = []
  const signals: AbortSignal[] = []
  const sdk = client(async (request) => {
    const url = new URL(request.url)
    expect(url.origin).toBe("http://drain.test")
    expect(url.pathname).toBe(request.method === "GET" ? "/prefix/config" : "/prefix/session/ses_test/summarize")
    expect(request.headers.get("authorization")).toBe("Basic test-only")
    paths.push(url.searchParams.get("directory"))
    signals.push(request.signal)
    return Response.json(request.method === "GET" ? {} : true)
  })
  const scoped = KiloRunDrain.scope(sdk, "/session owner", abort.signal)
  await scoped.config.get()
  await KiloRunDrain.scope(scoped, "/resumed owner").config.get()
  await KiloRun.runBuiltin(
    scoped,
    "ses_test",
    "compact",
    undefined,
    { providerID: "test", id: "model" },
    "/session owner",
  )
  await sdk.config.get()
  abort.abort()
  expect(paths).toEqual(["/session owner", "/resumed owner", "/session owner", null])
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true, true, false])
})

test.each([
  () => new Response("<html>old server</html>", { headers: { "content-type": "text/html" } }),
  () => Response.json({ paths: {} }),
  () => Response.json({ error: "Not Found" }, { status: 404 }),
])("rejects unsupported or HTML-returning servers", async (response) => {
  const sdk = client(async () => response())
  await expect(KiloRunDrain.check(sdk, new AbortController().signal)).rejects.toThrow(
    "does not support session draining",
  )
})

test.each([401, 403])("reports HTTP %i as an authentication or authorization failure", async (status) => {
  const sdk = client(async () => new Response("private error body", { status }))
  await expect(KiloRunDrain.check(sdk, new AbortController().signal)).rejects.toThrow(
    `Server rejected access (HTTP ${status})`,
  )
})

test.each([429, 500, 503])("preserves HTTP %i instead of recommending a server upgrade", async (status) => {
  const sdk = client(async () => new Response("private error body", { status }))
  await expect(KiloRunDrain.check(sdk, new AbortController().signal)).rejects.toThrow(
    `Server capability check failed (HTTP ${status})`,
  )
})

test("reports invalid JSON without exposing the response body", async () => {
  const sdk = client(
    async () => new Response("private invalid payload", { headers: { "content-type": "application/json" } }),
  )
  await expect(KiloRunDrain.check(sdk, new AbortController().signal)).rejects.toThrow(
    "Server returned invalid capability JSON",
  )
})

test.each(["EPIPE", "ERR_STREAM_DESTROYED"])("flush tolerates closed output %s", async (code) => {
  const error = Object.assign(new Error("closed output"), { code })
  await KiloRunDrain.flush([{ write: (_chunk, callback) => callback(error) }])
  await KiloRunDrain.flush([
    {
      write: () => {
        throw error
      },
    },
  ])
})

test("flush preserves other I/O errors", async () => {
  const error = Object.assign(new Error("output failed"), { code: "EIO" })
  await expect(KiloRunDrain.flush([{ write: (_chunk, callback) => callback(error) }])).rejects.toBe(error)
})

test("flush waits for all output callbacks", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  let done = false
  const output = KiloRunDrain.flush([
    { write: (_chunk, callback) => void first.promise.then(() => callback()) },
    { write: (_chunk, callback) => void second.promise.then(() => callback()) },
  ]).then(() => {
    done = true
  })
  first.resolve()
  await first.promise
  expect(done).toBe(false)
  second.resolve()
  await output
  expect(done).toBe(true)
})

test("accepts an acknowledgment that arrives before the HTTP result", async () => {
  const response = Promise.withResolvers<Response>()
  const drain = KiloRunDrain.create("ses_parent")
  const sdk = client(() => response.promise)
  const waiting = drain.wait(sdk)
  expect(drain.event(event("wrong"))).toBe(false)
  expect(drain.event(event(drain.token, "ses_other"))).toBe(false)
  expect(drain.event(event(drain.token))).toBe(true)
  response.resolve(Response.json(true))
  await waiting
  drain.close()
})

test("accepts the HTTP result before the matching acknowledgment", async () => {
  const received = Promise.withResolvers<void>()
  const drain = KiloRunDrain.create("ses_parent")
  const sdk = client(async () => Response.json(true))
  const original = sdk.kilocode.drainSession.bind(sdk.kilocode)
  sdk.kilocode.drainSession = (params, options) => {
    const result = original(params, options)
    void result.then(() => received.resolve())
    return result
  }
  const waiting = drain.wait(sdk)
  await received.promise
  expect(drain.event(event(drain.token))).toBe(true)
  await waiting
  drain.close()
})

test("stream loss fails a pending wait instead of reporting completion", async () => {
  const response = Promise.withResolvers<Response>()
  const drain = KiloRunDrain.create("ses_parent")
  const sdk = client(() => response.promise)
  const waiting = drain.wait(sdk)
  drain.end()
  await expect(waiting).rejects.toThrow("event stream ended before completion")
  response.resolve(Response.json(true))
  drain.close()
})

test("closing a run aborts pending retry waits", async () => {
  const drain = KiloRunDrain.create("ses_parent")
  const waiting = drain.pause(60_000)
  drain.close()
  await expect(waiting).rejects.toThrow()
})

test("session cancellation fails a drain after the parent turn already closed", async () => {
  const drain = KiloRunDrain.create("ses_parent")
  drain.event({
    id: "evt_done",
    type: "session.turn.close",
    properties: { sessionID: "ses_parent", reason: "completed" },
  })
  drain.event({ id: "evt_other", type: "session.drain.interrupted", properties: { sessionID: "ses_other" } })
  drain.event({ id: "evt_ready", type: "server.connected", properties: {} })
  await drain.ready()
  const waiting = drain.race(Promise.withResolvers<void>().promise)
  drain.event({ id: "evt_cancel", type: "session.drain.interrupted", properties: { sessionID: "ses_parent" } })
  await expect(waiting).rejects.toThrow("Session interrupted")
  drain.close()
})

test("a root interruption fails but a superseded handoff and child interruption do not", async () => {
  const drain = KiloRunDrain.create("ses_parent")
  drain.event({
    id: "evt_superseded",
    type: "session.turn.close",
    properties: { sessionID: "ses_parent", reason: "superseded" },
  })
  drain.event({
    id: "evt_child",
    type: "session.turn.close",
    properties: { sessionID: "ses_child", reason: "interrupted" },
  })
  drain.event({ id: "evt_ready", type: "server.connected", properties: {} })
  await drain.ready()
  const waiting = drain.race(new Promise<void>(() => undefined))
  drain.event({
    id: "evt_root",
    type: "session.turn.close",
    properties: { sessionID: "ses_parent", reason: "interrupted" },
  })
  await expect(waiting).rejects.toThrow("Session interrupted")
  drain.close()
})
