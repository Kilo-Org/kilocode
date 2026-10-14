import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { BrowserAutomationService } from "../../src/services/browser-automation/browser-automation-service"
import { createKiloClient } from "../../../sdk/js/src/v2/client"
import { wrapClientError } from "../../../sdk/js/src/error-interceptor"

const SECRET = "secret-token-do-not-log"

type Mode = "503" | "reset" | "hang" | "recover" | "connected" | "failed" | "bad"

describe("optional Playwright readiness HTTP boundary", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  const warnings: string[] = []
  const crashes: unknown[] = []
  let dir: string
  let server: Server
  let port: number
  let mode: Mode
  let gets: number
  let posts: number
  let service: BrowserAutomationService
  let warn: typeof console.warn
  const onCrash = (error: unknown) => {
    crashes.push(error)
  }

  function folders(path: string) {
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: [{ uri: vscode.Uri.file(path), name: "repo", index: 0 }],
    })
  }

  function listen(): Promise<number> {
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (!address || typeof address === "string") throw new Error("no port")
        resolve(address.port)
      })
    })
  }

  function respond(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/mcp") gets += 1
    if (req.method === "POST") posts += 1
    if (mode === "reset") {
      req.socket.destroy()
      return
    }
    if (mode === "hang") return
    if (mode === "503") {
      res.writeHead(503)
      res.end()
      return
    }
    if (mode === "bad") {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ message: "bad directory" }))
      return
    }
    if (mode === "failed") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ "kilo-playwright": { status: "failed", error: "MCP startup failed" } }))
      return
    }
    if (mode === "recover" && gets === 1) {
      res.writeHead(503)
      res.end()
      return
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ "kilo-playwright": { status: "connected" } }))
  }

  async function start(wait = 250) {
    gets = 0
    posts = 0
    crashes.length = 0
    warnings.length = 0
    dir = mkdtempSync(join(tmpdir(), `${SECRET}-`))
    folders(dir)
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: true })
    Object.defineProperty(vscode.workspace, "onDidChangeWorkspaceFolders", {
      configurable: true,
      value: () => ({ dispose: () => undefined }),
    })
    vscode.workspace.getConfiguration = (() => ({
      get: (key: string, fallback: unknown) => (key === "enabled" ? true : fallback),
    })) as typeof vscode.workspace.getConfiguration
    server = createServer(respond)
    port = await listen()
    if (mode === "reset") await new Promise<void>((resolve) => server.close(() => resolve()))
    const client = createKiloClient({
      baseUrl: `http://${SECRET}:pw@127.0.0.1:${port}`,
    })
    const connection = {
      onEvent: () => () => undefined,
      getClient: () => client,
    } as unknown as KiloConnectionService
    service = new BrowserAutomationService(connection, wait)
    warn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "))
    }
    process.on("unhandledRejection", onCrash)
  }

  async function stop() {
    service?.dispose()
    if (warn) console.warn = warn
    process.off("unhandledRejection", onCrash)
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (dir) rmSync(dir, { recursive: true, force: true })
    for (const key of Object.getOwnPropertyNames(vscode.workspace)) {
      if (!(key in descriptors)) Reflect.deleteProperty(vscode.workspace, key)
    }
    Object.defineProperties(vscode.workspace, descriptors)
    service = undefined as unknown as BrowserAutomationService
    server = undefined as unknown as Server
    dir = ""
  }

  afterEach(async () => {
    await stop()
  })

  function leaked(): boolean {
    return warnings.some((line) => line.includes(SECRET) || line.includes("http://") || line.includes("directory="))
  }

  test("redacts secret URLs from SDK transport errors", () => {
    const request = new Request(`http://${SECRET}:pw@127.0.0.1:9/mcp?directory=/${SECRET}`)
    const response = new Response(null, { status: 503, statusText: "Service Unavailable" })
    const error = wrapClientError("", response, request, { throwOnError: true })
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain("503")
    expect(message).toContain("/mcp")
    expect(message).not.toContain(SECRET)
    expect(message).not.toContain("directory=")
    expect((error as { cause?: { status?: number } }).cause?.status).toBe(503)
  })

  test("empty 503 does not abort the prompt", async () => {
    mode = "503"
    await start()
    let sent = false
    await service.ready(dir)
    sent = true
    expect(sent).toBe(true)
    expect(gets).toBeGreaterThan(1)
    expect(gets).toBeLessThanOrEqual(5)
    expect(posts).toBe(0)
    expect(warnings.some((line) => line.includes("HTTP 503"))).toBe(true)
    expect(leaked()).toBe(false)
    expect(crashes).toEqual([])
  })

  test("network failure does not abort the prompt", async () => {
    mode = "reset"
    await start()
    let sent = false
    await service.ready(dir)
    sent = true
    expect(sent).toBe(true)
    expect(warnings.join("\n")).toContain("network")
    expect(leaked()).toBe(false)
    expect(crashes).toEqual([])
  })

  test("a hung status GET times out without a background rejection", async () => {
    mode = "hang"
    await start(60)
    let sent = false
    await service.ready(dir)
    sent = true
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(sent).toBe(true)
    expect(leaked()).toBe(false)
    expect(crashes).toEqual([])
  })

  test("an internal fetch TimeoutError does not abort the prompt when it beats the outer readiness timer", async () => {
    mode = "hang"
    await start(60)
    const original = globalThis.setTimeout
    // AbortSignal.timeout uses the runtime timer, independent of this outer wait.
    globalThis.setTimeout = ((handler, delay, ...args) =>
      original(handler, delay === 60 ? 300 : delay, ...args)) as typeof setTimeout
    try {
      await expect(service.ready(dir)).resolves.toBeUndefined()
      expect(gets).toBe(1)
      expect(crashes).toEqual([])
      expect(leaked()).toBe(false)
    } finally {
      globalThis.setTimeout = original
    }
  })

  test("MCP not ready still blocks the prompt", async () => {
    mode = "failed"
    await start()
    let sent = false
    await expect(service.ready(dir)).rejects.toThrow("could not connect")
    expect(sent).toBe(false)
    expect(gets).toBe(1)
    expect(posts).toBe(0)
  })

  test("connected status lets the prompt continue", async () => {
    mode = "connected"
    await start()
    let sent = false
    await service.ready(dir)
    sent = true
    expect(sent).toBe(true)
    expect(gets).toBe(1)
    expect(warnings.some((line) => line.includes("optional MCP status"))).toBe(false)
  })

  test("a recovered status GET retries then continues", async () => {
    mode = "recover"
    await start()
    let sent = false
    await service.ready(dir)
    sent = true
    expect(sent).toBe(true)
    expect(gets).toBe(2)
    expect(posts).toBe(0)
    expect(leaked()).toBe(false)
  })

  test("concurrent prompts coalesce onto one status retry", async () => {
    mode = "recover"
    await start()
    let sent = 0
    await Promise.all([
      service.ready(dir).then(() => {
        sent += 1
      }),
      service.ready(dir).then(() => {
        sent += 1
      }),
    ])
    expect(sent).toBe(2)
    expect(gets).toBe(2)
  })

  test("cancellation does not continue into prompt send", async () => {
    mode = "hang"
    await start(5_000)
    const signal = new AbortController()
    let sent = false
    const run = (async () => {
      await service.ready(dir, signal.signal)
      sent = true
    })()
    setTimeout(() => signal.abort(), 20)
    await expect(run).rejects.toThrow(/abort/i)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(sent).toBe(false)
    expect(crashes).toEqual([])
    expect(leaked()).toBe(false)
  })

  test("a non-transport HTTP error still aborts the prompt", async () => {
    mode = "bad"
    await start()
    let sent = false
    await expect(
      (async () => {
        await service.ready(dir)
        sent = true
      })(),
    ).rejects.toThrow()
    expect(sent).toBe(false)
    expect(gets).toBe(1)
  })

  test("a programming error is not treated as transport", async () => {
    dir = mkdtempSync(join(tmpdir(), `${SECRET}-`))
    folders(dir)
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: true })
    Object.defineProperty(vscode.workspace, "onDidChangeWorkspaceFolders", {
      configurable: true,
      value: () => ({ dispose: () => undefined }),
    })
    vscode.workspace.getConfiguration = (() => ({
      get: (key: string, fallback: unknown) => (key === "enabled" ? true : fallback),
    })) as typeof vscode.workspace.getConfiguration
    const client = {
      mcp: {
        status: async () => {
          throw new TypeError("Cannot read properties of undefined (reading 'status')")
        },
        add: async () => ({ data: {} }),
        disconnect: async () => undefined,
      },
    } as unknown as KiloClient
    const connection = {
      onEvent: () => () => undefined,
      getClient: () => client,
    } as unknown as KiloConnectionService
    service = new BrowserAutomationService(connection, 200)
    warn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "))
    }
    let sent = false
    await expect(
      (async () => {
        await service.ready(dir)
        sent = true
      })(),
    ).rejects.toThrow("Cannot read properties")
    expect(sent).toBe(false)
  })
})
