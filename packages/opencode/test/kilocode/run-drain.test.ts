import { expect, test } from "bun:test"
import { KiloRunDrain } from "@/kilocode/cli/run-drain"

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
