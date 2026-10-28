import { expect, test } from "bun:test"
import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createFetchWithInit } from "@modelcontextprotocol/sdk/shared/transport.js"
import { probe } from "@/kilocode/mcp/sse-probe"

const ENDPOINT = "http://mcp.invalid/mcp"

const get = (headers: Record<string, string>, status = 200) =>
  new Response("<html>not an event stream</html>", { status, headers })

const sse = { accept: "text/event-stream" }

const json = (message: unknown) =>
  new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } })

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "probe", version: "1" } },
}

const reconnection = {
  initialReconnectionDelay: 1,
  maxReconnectionDelay: 1,
  reconnectionDelayGrowFactor: 1,
  maxRetries: 2,
}

/** Drive the handshake that makes the transport request its optional GET stream. */
async function handshake(transport: StreamableHTTPClientTransport) {
  await transport.start()
  await transport.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } },
  })
  await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
}

test("reports 405 for a GET probe answered with a body that is not an event stream", async () => {
  const response = await probe(async () => get({ "content-type": "text/html" }))(
    new URL(ENDPOINT),
    { method: "GET", headers: sse },
  )

  expect(response.status).toBe(405)
})

test("passes a GET probe answered with an event stream through", async () => {
  const response = await probe(async () => get({ "content-type": "text/event-stream" }))(
    new URL(ENDPOINT),
    { method: "GET", headers: sse },
  )

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("text/event-stream")
})

test("matches the event stream content type case-insensitively", async () => {
  const response = await probe(async () => get({ "content-type": "TEXT/EVENT-STREAM; charset=utf-8" }))(
    new URL(ENDPOINT),
    { method: "GET", headers: sse },
  )

  expect(response.status).toBe(200)
})

test("passes other requests through", async () => {
  const request = probe(async (_input, init) => {
    if (init?.method === "GET") return get({ "content-type": "text/html" }, 500)
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  })

  const posted = await request(new URL(ENDPOINT), { method: "POST", body: "{}" })
  const failed = await request(new URL(ENDPOINT), { method: "GET", headers: sse })

  expect(posted.status).toBe(200)
  expect(failed.status).toBe(500)
})

test("keeps a GET probe response that declares no content type", async () => {
  const response = await probe(async () => new Response("<html>no header</html>", { status: 200 }))(
    new URL(ENDPOINT),
    { method: "GET", headers: sse },
  )

  expect(response.status).toBe(200)
})

test("leaves a GET without an event stream Accept header untouched", async () => {
  const response = await probe(async () => get({ "content-type": "text/html" }))(
    new URL(ENDPOINT),
    { method: "GET", headers: { accept: "application/json" } },
  )

  expect(response.status).toBe(200)
})

test("leaves a GET outside the configured endpoint untouched", async () => {
  const response = await probe(async () => get({ "content-type": "text/html" }), ENDPOINT)(
    new URL("http://auth.invalid/.well-known/oauth-authorization-server"),
    { method: "GET", headers: sse },
  )

  expect(response.status).toBe(200)
})

test("leaves an implicit GET request object outside the endpoint untouched", async () => {
  const response = await probe(async () => get({ "content-type": "text/html" }), ENDPOINT)(
    new Request("http://auth.invalid/.well-known/oauth-protected-resource", {
      headers: { accept: "application/json" },
    }),
  )

  expect(response.status).toBe(200)
})

test("requests the optional stream once when the server answers with a non-SSE body", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: probe(async (_input, init) => {
      const method = init?.method ?? "GET"
      seen.push(method)
      if (method === "GET") return get({ "content-type": "text/html" })
      if (String(init?.body ?? "").includes("notifications/initialized")) return new Response(null, { status: 202 })
      return json(initialize)
    }, ENDPOINT),
    reconnectionOptions: reconnection,
  })

  await handshake(transport)
  await Bun.sleep(100)
  await transport.close()

  expect(seen.filter((method) => method === "GET").length).toBe(1)
})

test("requests the optional stream once when a same-origin redirect leads to a non-SSE body", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: probe(async (input, init) => {
      const method = init?.method ?? "GET"
      const url = new URL(input instanceof Request ? input.url : input)
      if (method === "GET") {
        seen.push(url.pathname)
        if (url.pathname === "/mcp") return new Response(null, { status: 307, headers: { location: "/stream" } })
        return get({ "content-type": "text/html" })
      }
      if (String(init?.body ?? "").includes("notifications/initialized")) return new Response(null, { status: 202 })
      return json(initialize)
    }, ENDPOINT),
    reconnectionOptions: reconnection,
  })

  await handshake(transport)
  await Bun.sleep(100)
  await transport.close()

  expect(seen).toEqual(["/mcp", "/stream"])
})

test("follows the stream request through a chain of same-origin redirects", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: probe(async (input, init) => {
      const method = init?.method ?? "GET"
      const url = new URL(input instanceof Request ? input.url : input)
      if (method === "GET") {
        seen.push(url.pathname)
        if (url.pathname === "/mcp") return new Response(null, { status: 307, headers: { location: "/hop" } })
        if (url.pathname === "/hop") return new Response(null, { status: 308, headers: { location: "/stream" } })
        return get({ "content-type": "text/html" })
      }
      if (String(init?.body ?? "").includes("notifications/initialized")) return new Response(null, { status: 202 })
      return json(initialize)
    }, ENDPOINT),
    reconnectionOptions: reconnection,
  })

  await handshake(transport)
  await Bun.sleep(100)
  await transport.close()

  expect(seen).toEqual(["/mcp", "/hop", "/stream"])
})

test("keeps same-origin OAuth discovery working when configured headers accept event streams", async () => {
  const metadata = { resource: ENDPOINT, authorization_servers: ["http://mcp.invalid"] }
  const fetch = createFetchWithInit(
    probe(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(metadata)
      return new Response(null, { status: 404 })
    }, ENDPOINT),
    { headers: { Accept: "application/json, text/event-stream" } },
  )

  const result = await discoverOAuthProtectedResourceMetadata(ENDPOINT, undefined, fetch)

  expect(result.resource).toBe(ENDPOINT)
})

test("leaves a same-origin JSON GET outside the stream request untouched", async () => {
  const response = await probe(async () => json({ resource: ENDPOINT }), ENDPOINT)(
    new URL("http://mcp.invalid/oauth/metadata"),
    { method: "GET", headers: { accept: "application/json, text/event-stream" } },
  )

  expect(response.status).toBe(200)
})

test("repeats the optional stream without the probe", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: async (_input, init) => {
      const method = init?.method ?? "GET"
      seen.push(method)
      if (method === "GET") return get({ "content-type": "text/html" })
      if (String(init?.body ?? "").includes("notifications/initialized")) return new Response(null, { status: 202 })
      return json(initialize)
    },
    reconnectionOptions: reconnection,
  })

  await handshake(transport)
  await Bun.sleep(100)
  await transport.close()

  expect(seen.filter((method) => method === "GET").length).toBeGreaterThan(2)
})
