import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client, capture } from "./mcp"

const PROTOCOL = "2025-11-25"
const SESSION = "test-session"
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

type Body = Record<string, unknown>
type Params = { name?: string; arguments?: Body }
type Seen = { method: string; session: string | null; body: Body }
type Handler = (body: Body) => Response | Promise<Response> | undefined

function reply(id: unknown, result: unknown, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers })
}

function textCall(value: unknown, error = false): unknown {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError: error }
}

function callResult(content: unknown, error = false): unknown {
  return { content, isError: error }
}

function peer(handler?: Handler) {
  const seen: Seen[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (req.method === "DELETE") {
        seen.push({ method: "DELETE", session: req.headers.get("mcp-session-id"), body: {} })
        return new Response(null, { status: 204 })
      }
      const body = (await req.json()) as Body
      const method = String(body.method)
      seen.push({ method, session: req.headers.get("mcp-session-id"), body })
      const custom = handler ? await handler(body) : undefined
      if (custom) return custom
      const id = body.id
      if (method === "initialize") {
        return reply(
          id,
          { protocolVersion: PROTOCOL, capabilities: {}, serverInfo: { name: "peer", version: "1.0.0" } },
          { "Mcp-Session-Id": SESSION },
        )
      }
      if (method === "notifications/initialized") return new Response(null, { status: 202 })
      if (method === "ping") return reply(id, { ok: true })
      if (method === "missing") {
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } })
      }
      if (method === "http-error") return new Response("peer unavailable", { status: 503 })
      if (method === "tools/call") {
        const params = body.params as Params
        if (params.name === "echo") {
          return reply(id, callResult([{ type: "text", text: JSON.stringify(params.arguments ?? {}) }]))
        }
        if (params.name === "bad") return reply(id, callResult([{ type: "text", text: "bad input" }], true))
      }
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } })
    },
  })
  const port = server.port
  if (port == null) throw new Error("peer did not bind a port")
  return { server, seen, port }
}

test("connect initializes a session and sends it on later calls", async () => {
  const { port, seen, server } = peer()
  const client = await Client.connect(port)
  try {
    expect(await client.request("ping")).toEqual({ ok: true })
  } finally {
    await client.close()
    await server.stop(true)
  }
  expect(seen.map((entry) => entry.method)).toEqual(["initialize", "notifications/initialized", "ping", "DELETE"])
  expect(seen.at(0)?.session).toBeNull()
  expect(seen.at(1)?.session).toBe(SESSION)
  expect(seen.at(2)?.session).toBe(SESSION)
  expect(seen.at(3)?.session).toBe(SESSION)
})

test("connect rejects a protocol mismatch", async () => {
  const { port, server } = peer((body) => {
    if (body.method !== "initialize") return
    return reply(body.id, { protocolVersion: "2024-11-05", capabilities: {} })
  })
  try {
    await expect(Client.connect(port)).rejects.toThrow("MCP protocol mismatch")
  } finally {
    await server.stop(true)
  }
})

test("propagates JSON-RPC, HTTP, and tool failures", async () => {
  const { port, server } = peer()
  const client = await Client.connect(port)
  try {
    await expect(client.request("missing")).rejects.toThrow("MCP -32601: Method not found")
    await expect(client.request("http-error")).rejects.toThrow("MCP HTTP 503: peer unavailable")
    await expect(client.tool("bad")).rejects.toThrow("MCP tool bad failed: bad input")
    const echo = await client.tool("echo", { value: 7 })
    expect(echo.isError).toBe(false)
    expect(echo.content).toEqual([{ type: "text", text: '{"value":7}' }])
  } finally {
    await client.close()
    await server.stop(true)
  }
})

test("capture selects the sole project and writes only the decoded PNG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jetbrains-sandbox-"))
  const out = join(dir, "shot.png")
  const shots: Body[] = []
  const { port, server } = peer((body) => {
    if (body.method !== "tools/call") return
    const params = body.params as Params
    if (params.name === "steroid_list_projects") {
      return reply(body.id, textCall({ projects: [{ project_name: "demo-key", name: "demo", path: "/tmp/demo" }] }))
    }
    if (params.name === "steroid_list_windows") {
      return reply(
        body.id,
        textCall({
          windows: [
            {
              windowId: "win-1",
              project_name: "demo-key",
              title: "demo - IntelliJ IDEA",
              isVisible: true,
              isActive: true,
            },
          ],
        }),
      )
    }
    if (params.name === "steroid_take_screenshot") {
      shots.push(params.arguments ?? {})
      return reply(body.id, callResult([{ type: "image", data: PNG, mimeType: "image/png" }]))
    }
  })
  const client = await Client.connect(port)
  try {
    expect(await capture(client, { out })).toBe(out)
    expect(new Uint8Array(await readFile(out))).toEqual(new Uint8Array(Buffer.from(PNG, "base64")))
    expect(shots).toHaveLength(1)
    expect(shots.at(0)).toMatchObject({ project_name: "demo-key", window_id: "win-1", task_id: "jetbrains-sandbox" })
    expect(typeof shots.at(0)?.reason).toBe("string")
  } finally {
    await client.close()
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

test("capture opens Settings and waits for the actual dialog window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jetbrains-sandbox-"))
  const out = join(dir, "settings.png")
  let lists = 0
  let code: Body | undefined
  let shot: Body | undefined
  const { port, server } = peer((body) => {
    if (body.method !== "tools/call") return
    const params = body.params as Params
    if (params.name === "steroid_list_projects") {
      return reply(body.id, textCall({ projects: [{ project_name: "demo-key", name: "demo", path: "/tmp/demo" }] }))
    }
    if (params.name === "steroid_list_windows") {
      lists++
      const frame = {
        windowId: "frame-1",
        project_name: "demo-key",
        title: "demo - IntelliJ IDEA",
        isVisible: true,
        isActive: true,
      }
      const windows =
        lists === 1 ? [frame] : [frame, { windowId: "settings-1", title: "Settings", isVisible: true, isActive: true }]
      return reply(body.id, textCall({ windows }))
    }
    if (params.name === "steroid_execute_code") {
      code = params.arguments
      return reply(body.id, callResult([{ type: "text", text: "Requested Settings dialog (Appearance)" }]))
    }
    if (params.name === "steroid_take_screenshot") {
      shot = params.arguments
      return reply(body.id, callResult([{ type: "image", data: PNG, mimeType: "image/png" }]))
    }
  })
  const client = await Client.connect(port)
  try {
    expect(await capture(client, { out, settings: true })).toBe(out)
    expect(lists).toBe(2)
    expect(code).toMatchObject({ project_name: "demo-key", modal: "unleashed", task_id: "jetbrains-sandbox" })
    expect(String(code?.code)).toContain('showSettingsDialog(project, "Appearance")')
    expect(String(code?.code)).toContain("import com.intellij.openapi.options.ShowSettingsUtil")
    expect(String(code?.code)).not.toContain("null")
    expect(shot).toMatchObject({ project_name: "demo-key", window_id: "settings-1", task_id: "jetbrains-sandbox" })
  } finally {
    await client.close()
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

test("capture reuses an existing Settings window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jetbrains-sandbox-"))
  const out = join(dir, "settings.png")
  let executed = false
  let shot: Body | undefined
  const { port, server } = peer((body) => {
    if (body.method !== "tools/call") return
    const params = body.params as Params
    if (params.name === "steroid_list_projects") {
      return reply(body.id, textCall({ projects: [{ project_name: "demo-key", name: "demo", path: "/tmp/demo" }] }))
    }
    if (params.name === "steroid_list_windows") {
      return reply(
        body.id,
        textCall({
          windows: [
            { windowId: "frame-1", project_name: "demo-key", title: "demo - IntelliJ IDEA", isVisible: true },
            { windowId: "settings-1", title: "Settings", isVisible: true, isActive: true },
          ],
        }),
      )
    }
    if (params.name === "steroid_execute_code") {
      executed = true
      return reply(body.id, callResult([{ type: "text", text: "opened" }]))
    }
    if (params.name === "steroid_take_screenshot") {
      shot = params.arguments
      return reply(body.id, callResult([{ type: "image", data: PNG, mimeType: "image/png" }]))
    }
  })
  const client = await Client.connect(port)
  try {
    expect(await capture(client, { out, settings: true })).toBe(out)
    expect(executed).toBe(false)
    expect(shot).toMatchObject({ window_id: "settings-1" })
  } finally {
    await client.close()
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

test("capture reports an unrelated modal instead of dismissing it", async () => {
  const out = join(tmpdir(), `jetbrains-sandbox-${Date.now()}.png`)
  let executed = false
  const { port, server } = peer((body) => {
    if (body.method !== "tools/call") return
    const params = body.params as Params
    if (params.name === "steroid_list_projects") {
      return reply(body.id, textCall({ projects: [{ project_name: "demo-key", name: "demo", path: "/tmp/demo" }] }))
    }
    if (params.name === "steroid_list_windows") {
      return reply(
        body.id,
        textCall({
          windows: [{ windowId: "legal-1", title: "Legal Agreement", isVisible: true, modalDialogShowing: true }],
        }),
      )
    }
    if (params.name === "steroid_execute_code") {
      executed = true
      return reply(body.id, callResult([{ type: "text", text: "opened" }]))
    }
  })
  const client = await Client.connect(port)
  try {
    await expect(capture(client, { out, settings: true })).rejects.toThrow("unrelated modal is active")
    expect(executed).toBe(false)
  } finally {
    await client.close()
    await server.stop(true)
  }
})

test("capture requires an unambiguous project", async () => {
  const { port, server } = peer((body) => {
    if (body.method !== "tools/call") return
    const params = body.params as Params
    if (params.name === "steroid_list_projects") {
      return reply(
        body.id,
        textCall({
          projects: [
            { project_name: "left-key", name: "demo", path: "/work/left" },
            { project_name: "right-key", name: "demo", path: "/work/right" },
          ],
        }),
      )
    }
  })
  const client = await Client.connect(port)
  try {
    await expect(capture(client, { out: join(tmpdir(), "unused.png"), project: "demo" })).rejects.toThrow(
      "is ambiguous",
    )
  } finally {
    await client.close()
    await server.stop(true)
  }
})
