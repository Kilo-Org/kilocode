import { expect, test } from "bun:test"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { probe } from "@/kilocode/mcp/sse-probe"

const get = (headers: Record<string, string>, status = 200) =>
  new Response("<html>not an event stream</html>", { status, headers })

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
    new URL("http://mcp.invalid"),
    { method: "GET" },
  )

  expect(response.status).toBe(405)
})

test("passes a GET probe answered with an event stream through", async () => {
  const response = await probe(async () => get({ "content-type": "text/event-stream" }))(
    new URL("http://mcp.invalid"),
    { method: "GET" },
  )

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("text/event-stream")
})

test("matches the event stream content type case-insensitively", async () => {
  const response = await probe(async () => get({ "content-type": "TEXT/EVENT-STREAM; charset=utf-8" }))(
    new URL("http://mcp.invalid"),
    { method: "GET" },
  )

  expect(response.status).toBe(200)
})

test("passes other requests through", async () => {
  const request = probe(async (_input, init) => {
    if (init?.method === "GET") return get({ "content-type": "text/html" }, 500)
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  })

  const posted = await request(new URL("http://mcp.invalid"), { method: "POST", body: "{}" })
  const failed = await request(new URL("http://mcp.invalid"), { method: "GET" })

  expect(posted.status).toBe(200)
  expect(failed.status).toBe(500)
})

test("keeps a GET probe response that declares no content type", async () => {
  const response = await probe(async () => new Response("<html>no header</html>", { status: 200 }))(
    new URL("http://mcp.invalid"),
    { method: "GET" },
  )

  expect(response.status).toBe(200)
})

test("requests the optional stream once when the server answers with a non-SSE body", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.invalid"), {
    fetch: probe(async (_input, init) => {
      const method = init?.method ?? "GET"
      seen.push(method)
      if (method === "GET") return get({ "content-type": "text/html" })
      if (String(init?.body ?? "").includes("notifications/initialized")) return new Response(null, { status: 202 })
      return json(initialize)
    }),
    reconnectionOptions: reconnection,
  })

  await handshake(transport)
  await Bun.sleep(100)
  await transport.close()

  expect(seen.filter((method) => method === "GET").length).toBe(1)
})

test("repeats the optional stream without the probe", async () => {
  const seen: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.invalid"), {
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
