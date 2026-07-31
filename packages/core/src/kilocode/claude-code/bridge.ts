// Minimal MCP (streamable HTTP) server that exposes Kilo's tools to the
// Claude Code CLI.
//
// Why hand-rolled rather than @modelcontextprotocol/sdk: this server is not a
// normal MCP server. A `tools/call` is never executed here — Kilo's agent loop
// owns execution, permissions, and the UI. Instead the request is *parked*: we
// surface it to the language model as an AI SDK tool-call and hold the JSON-RPC
// response open until the outer loop feeds the result back on a later
// `doStream`. That inversion is the whole point of the bridge, and it is
// simpler to express directly over four JSON-RPC methods than to bend an SDK
// server around it. It also keeps `packages/core` free of a new dependency.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

/** MCP namespaces tools as `mcp__<server>__<tool>`; keep the server name short. */
export const SERVER_NAME = "kilo"
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

const PROTOCOL_VERSION = "2025-06-18"

export type ToolSpec = {
  name: string
  description: string
  inputSchema: unknown
}

export type BridgeCall = {
  /** Bridge-generated id, reused as the AI SDK toolCallId. */
  id: string
  name: string
  args: unknown
}

export type CallResult = {
  text: string
  isError?: boolean
}

type Parked = {
  call: BridgeCall
  resolve: (result: CallResult) => void
}

export type Bridge = Awaited<ReturnType<typeof start>>

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }).end(text)
}

function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ""
    let settled = false
    req.on("data", (chunk) => {
      if (settled) return
      raw += chunk
      // Defensive cap: the CLI only ever posts small JSON-RPC frames. Destroy
      // the request once exceeded — rejecting alone doesn't stop `data` from
      // continuing to arrive and grow `raw`, so the cap wouldn't actually
      // bound memory.
      if (raw.length > 8_000_000) {
        settled = true
        req.destroy()
        reject(new Error("payload too large"))
      }
    })
    req.on("error", (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
    req.on("end", () => {
      if (settled) return
      settled = true
      try {
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch (cause) {
        reject(cause)
      }
    })
  })
}

/**
 * Start the bridge on an ephemeral loopback port.
 *
 * `onCall` is invoked as soon as the CLI requests a tool; the returned promise
 * for that call stays pending until {@link Bridge.settle} is called with the
 * result produced by Kilo's agent loop.
 */
export async function start(input: { tools: () => ToolSpec[]; onCall: (call: BridgeCall) => void }): Promise<{
  url: string
  token: string
  settle: (id: string, result: CallResult) => boolean
  pending: () => BridgeCall[]
  failAll: (message: string) => void
  close: () => Promise<void>
}> {
  const token = randomUUID()
  const parked = new Map<string, Parked>()

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The port is loopback-only, but any local process could still reach it;
    // a bearer token keeps other processes from driving Kilo's tools.
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "unauthorized" })
    if (req.method === "DELETE") return send(res, 204)
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" })

    const payload = (await body(req).catch(() => undefined)) as
      | { jsonrpc?: string; id?: unknown; method?: string; params?: any }
      | undefined
    if (!payload?.method) return send(res, 400, { error: "bad request" })

    const reply = (result: unknown) => send(res, 200, { jsonrpc: "2.0", id: payload.id, result })

    // Notifications carry no id and expect no JSON-RPC body.
    if (payload.id === undefined) return send(res, 202)

    if (payload.method === "initialize") {
      return reply({
        // Echo the client's protocol version when it offers one so we don't
        // fail negotiation against newer/older CLI builds.
        protocolVersion:
          typeof payload.params?.protocolVersion === "string" ? payload.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: "1.0.0" },
      })
    }
    if (payload.method === "ping") return reply({})
    if (payload.method === "tools/list") {
      return reply({
        tools: input.tools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      })
    }
    if (payload.method === "tools/call") {
      const name = payload.params?.name
      if (typeof name !== "string") {
        return send(res, 200, { jsonrpc: "2.0", id: payload.id, error: { code: -32602, message: "missing tool name" } })
      }
      const call: BridgeCall = { id: `cc_${randomUUID()}`, name, args: payload.params?.arguments ?? {} }
      const result = await new Promise<CallResult>((resolve) => {
        parked.set(call.id, { call, resolve })
        input.onCall(call)
      })
      // MCP reports tool failures in-band via isError so the model can react,
      // rather than as a JSON-RPC error which would abort the CLI turn.
      return reply({ content: [{ type: "text", text: result.text }], isError: result.isError === true })
    }
    return send(res, 200, {
      jsonrpc: "2.0",
      id: payload.id,
      error: { code: -32601, message: `unknown method ${payload.method}` },
    })
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "internal error" })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    settle: (id, result) => {
      const entry = parked.get(id)
      if (!entry) return false
      parked.delete(id)
      entry.resolve(result)
      return true
    },
    pending: () => Array.from(parked.values(), (entry) => entry.call),
    failAll: (message) => {
      for (const [id, entry] of parked) {
        parked.delete(id)
        entry.resolve({ text: message, isError: true })
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const [, entry] of parked) entry.resolve({ text: "Session closed.", isError: true })
        parked.clear()
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
  }
}
