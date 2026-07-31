import { describe, expect, test } from "bun:test"
import { start, TOOL_PREFIX, SERVER_NAME } from "../../src/kilocode/claude-code/bridge"

type Rpc = { jsonrpc: string; id?: number; method: string; params?: unknown }

async function call(bridge: { url: string; token: string }, payload: Rpc, token?: string) {
  return fetch(bridge.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? bridge.token}`,
    },
    body: JSON.stringify(payload),
  })
}

async function until(predicate: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const TOOLS = [{ name: "read", description: "Read a file", inputSchema: { type: "object", properties: {} } }]

describe("claude-code MCP bridge", () => {
  test("namespaces tools the way the CLI does", () => {
    expect(TOOL_PREFIX).toBe(`mcp__${SERVER_NAME}__`)
  })

  test("rejects requests without the bearer token", async () => {
    const bridge = await start({ tools: () => TOOLS, onCall: () => {} })
    try {
      const res = await call(bridge, { jsonrpc: "2.0", id: 1, method: "initialize" }, "wrong")
      expect(res.status).toBe(401)
    } finally {
      await bridge.close()
    }
  })

  test("initialize echoes the client protocol version and advertises tools", async () => {
    const bridge = await start({ tools: () => TOOLS, onCall: () => {} })
    try {
      const res = await call(bridge, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2099-01-01" },
      })
      const body = (await res.json()) as any
      expect(body.result.protocolVersion).toBe("2099-01-01")
      expect(body.result.capabilities.tools).toBeDefined()
      expect(body.result.serverInfo.name).toBe(SERVER_NAME)
    } finally {
      await bridge.close()
    }
  })

  test("tools/list reflects the current tool set on every call", async () => {
    let tools = TOOLS
    const bridge = await start({ tools: () => tools, onCall: () => {} })
    try {
      const first = (await (await call(bridge, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as any
      expect(first.result.tools.map((t: any) => t.name)).toEqual(["read"])
      // The model's available tools change between turns; the bridge must not
      // capture them at construction time.
      tools = [...TOOLS, { name: "write", description: "Write", inputSchema: { type: "object", properties: {} } }]
      const second = (await (await call(bridge, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any
      expect(second.result.tools.map((t: any) => t.name)).toEqual(["read", "write"])
    } finally {
      await bridge.close()
    }
  })

  test("parks tools/call until settled, then returns MCP content", async () => {
    const seen: any[] = []
    const bridge = await start({ tools: () => TOOLS, onCall: (c) => seen.push(c) })
    try {
      const pending = call(bridge, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "read", arguments: { path: "a.ts" } },
      })
      await until(() => seen.length === 1)
      // Still parked: the outer agent loop has not produced a result yet.
      expect(bridge.pending()).toHaveLength(1)
      expect(seen[0].name).toBe("read")
      expect(seen[0].args).toEqual({ path: "a.ts" })

      expect(bridge.settle(seen[0].id, { text: "contents" })).toBe(true)
      const body = (await (await pending).json()) as any
      expect(body.id).toBe(7)
      expect(body.result.content).toEqual([{ type: "text", text: "contents" }])
      expect(body.result.isError).toBe(false)
      expect(bridge.pending()).toHaveLength(0)
    } finally {
      await bridge.close()
    }
  })

  test("reports tool failures in-band so the CLI turn survives", async () => {
    const seen: any[] = []
    const bridge = await start({ tools: () => TOOLS, onCall: (c) => seen.push(c) })
    try {
      const pending = call(bridge, {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "read", arguments: {} },
      })
      await until(() => seen.length === 1)
      bridge.settle(seen[0].id, { text: "boom", isError: true })
      const body = (await (await pending).json()) as any
      // An MCP-level error, not a JSON-RPC error: the model should see and
      // react to it rather than the CLI aborting.
      expect(body.error).toBeUndefined()
      expect(body.result.isError).toBe(true)
    } finally {
      await bridge.close()
    }
  })

  test("settle reports false for an unknown id", async () => {
    const bridge = await start({ tools: () => TOOLS, onCall: () => {} })
    try {
      expect(bridge.settle("nope", { text: "x" })).toBe(false)
    } finally {
      await bridge.close()
    }
  })

  test("failAll releases parked calls instead of hanging the CLI", async () => {
    const seen: any[] = []
    const bridge = await start({ tools: () => TOOLS, onCall: (c) => seen.push(c) })
    try {
      const pending = call(bridge, {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "read", arguments: {} },
      })
      await until(() => seen.length === 1)
      bridge.failAll("cancelled")
      const body = (await (await pending).json()) as any
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toBe("cancelled")
    } finally {
      await bridge.close()
    }
  })

  test("unknown methods return a JSON-RPC error", async () => {
    const bridge = await start({ tools: () => TOOLS, onCall: () => {} })
    try {
      const body = (await (await call(bridge, { jsonrpc: "2.0", id: 3, method: "nope/nope" })).json()) as any
      expect(body.error.code).toBe(-32601)
    } finally {
      await bridge.close()
    }
  })

  test("notifications are acknowledged with 202 and no body", async () => {
    const bridge = await start({ tools: () => TOOLS, onCall: () => {} })
    try {
      const res = await call(bridge, { jsonrpc: "2.0", method: "notifications/initialized" })
      expect(res.status).toBe(202)
    } finally {
      await bridge.close()
    }
  })
})
