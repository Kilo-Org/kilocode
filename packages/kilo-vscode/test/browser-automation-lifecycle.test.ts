import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import type { Manager } from "../src/server"
import { BrowserAutomationService } from "../src/services/browser-automation/browser-automation-service"

// The service talks to the v2 server over HTTP, so this test serves the two MCP routes it uses and records the calls.
// A fake server object is closer to production than a mocked client and still needs no running Kilo server.
const NAME = "kilo-playwright"

type Recorded = { method: string; server: string; directory: string; command?: string[] }

function fake(url: string): Manager {
  return {
    get: () => Promise.resolve({ url, authorization: "Basic test", process: undefined as never }),
    stop: () => Promise.resolve(),
  }
}

describe("Playwright MCP lifecycle", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  const listeners = new Set<(event: unknown) => void>()
  const recorded: Recorded[] = []
  const active = new Set<string>()
  const failed = new Set<string>()
  let http: ReturnType<typeof Bun.serve>
  let service: BrowserAutomationService
  let enabled = true
  let startup = false
  let failAdd = false

  function folders(dirs: string[]) {
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: dirs.map((dir, index) => ({ uri: vscode.Uri.file(dir), name: dir, index })),
    })
  }

  beforeEach(async () => {
    recorded.length = 0
    active.clear()
    failed.clear()
    enabled = true
    startup = false
    failAdd = false
    folders(["/repo"])
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: true })
    vscode.workspace.getConfiguration = (() => ({
      get: (key: string, fallback: unknown) => (key === "enabled" ? enabled : fallback),
    })) as typeof vscode.workspace.getConfiguration
    Object.defineProperty(vscode.workspace, "onDidChangeConfiguration", {
      configurable: true,
      value: (listener: () => void) => {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
    })
    Object.defineProperty(vscode.workspace, "onDidChangeWorkspaceFolders", {
      configurable: true,
      value: (listener: () => void) => {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
    })
    http = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url)
        const directory = url.searchParams.get("location[directory]") ?? ""
        if (request.method === "PUT" && url.pathname.startsWith("/api/experimental/mcp/")) {
          const body = (await request.json()) as { config?: { command?: string[] } } | undefined
          recorded.push({ method: "add", server: url.pathname.split("/").at(-1) ?? "", directory, command: body?.config?.command })
          if (failAdd) return Response.json({ error: "MCP registration failed" }, { status: 500 })
          if (startup) failed.add(directory)
          else active.add(directory)
          return new Response(null, { status: 204 })
        }
        if (request.method === "DELETE" && url.pathname.startsWith("/api/experimental/mcp/")) {
          recorded.push({ method: "remove", server: url.pathname.split("/").at(-1) ?? "", directory })
          active.delete(directory)
          failed.delete(directory)
          return new Response(null, { status: 204 })
        }
        if (request.method === "GET" && url.pathname === "/api/mcp") {
          return Response.json({
            location: { directory },
            data: active.has(directory)
              ? [{ name: NAME, status: { status: "connected" } }]
              : failed.has(directory)
                ? [{ name: NAME, status: { status: "failed", error: "MCP startup failed" } }]
                : [],
          })
        }
        return new Response(null, { status: 404 })
      },
    })
    service = new BrowserAutomationService({ server: fake(http.url.origin) })
  })

  afterEach(() => {
    service.dispose()
    listeners.clear()
    http.stop(true)
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("registers the Playwright server for each workspace folder", async () => {
    folders(["/repo", "/second"])
    await service.syncWithSettings()
    expect(recorded.map((item) => [item.method, item.directory])).toEqual([
      ["add", "/repo"],
      ["add", "/second"],
    ])
    expect(recorded[0]!.server).toBe(NAME)
    expect(recorded[0]!.command?.slice(0, 2)).toEqual(["npx", "@playwright/mcp@latest"])
    expect([...active].sort()).toEqual(["/repo", "/second"])
  })

  test("reconciles folders without re-registering retained directories", async () => {
    folders(["/repo", "/old"])
    await service.syncWithSettings()
    folders(["/repo", "/new"])
    await service.syncWithSettings()
    expect(recorded.map((item) => [item.method, item.directory])).toEqual([
      ["add", "/repo"],
      ["add", "/old"],
      ["remove", "/old"],
      ["add", "/new"],
    ])
    expect([...active].sort()).toEqual(["/new", "/repo"])
  })

  test("a failed startup is recorded and the next sync retries it", async () => {
    startup = true
    await service.syncWithSettings()
    expect(recorded.length).toBe(1)
    startup = false
    await service.syncWithSettings()
    expect(recorded.length).toBe(2)
    expect([...active]).toEqual(["/repo"])
  })

  test("disabling removes the registration", async () => {
    await service.syncWithSettings()
    enabled = false
    await service.syncWithSettings()
    expect(recorded.map((item) => item.method)).toEqual(["add", "remove"])
    expect(active.size).toBe(0)
  })

  test("an untrusted workspace registers nothing", async () => {
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: false })
    await service.syncWithSettings()
    expect(recorded).toEqual([])
  })

  test("re-registers after the server restarts, which drops runtime MCP state", async () => {
    await service.syncWithSettings()
    active.clear()
    await service.started()
    expect(recorded.map((item) => item.method)).toEqual(["add", "add"])
    expect([...active]).toEqual(["/repo"])
  })

  test("a settings change starts one reconcile, and dispose stops it", async () => {
    await service.syncWithSettings()
    for (const listener of listeners) listener({ affectsConfiguration: () => true })
    await Bun.sleep(20)
    expect(recorded.length).toBe(1)
    service.dispose()
    expect(listeners.size).toBe(0)
  })

  test("a failed registration resolves and records the attempt", async () => {
    failAdd = true
    const result = await service.syncWithSettings()
    expect(result).toBeUndefined()
    expect(recorded.map((item) => item.method)).toEqual(["add"])
    expect(active.size).toBe(0)
  })
})