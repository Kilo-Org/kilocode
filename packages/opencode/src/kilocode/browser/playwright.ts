import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { existsSync } from "node:fs"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { Browser, BrowserContext } from "playwright-core"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import type { Entry } from "./contract-shape"
import { entries as readEntries, hash as readHash } from "./contract-shape"
import { UnavailableError } from "./backend"
import type { Backend, CallResult, CallContext, ContentBlock } from "./backend"
import { BrowserContract } from "./contract"
import { INSTALL_HINT, locate } from "./locate"
import type { Target } from "./locate"
import type { Settings } from "./settings"

const log = Log.create({ service: "browser.playwright" })

const TIMEOUT = 180_000

/** Snapshots are page content: inline them, but never read more than this from disk. */
const INLINE_LIMIT = 2 * 1024 * 1024

/**
 * Chrome on Ubuntu refuses to start when its sandbox helper is not setuid or unprivileged user
 * namespaces are restricted. Name the fix instead of surfacing a raw launch stack, and never paper
 * over it by disabling the sandbox.
 */
export function launchFailure(error: unknown, executable?: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (!/sandbox/i.test(message)) return error instanceof Error ? error : new Error(message)
  const sandbox = executable
    ? path.join(path.dirname(executable), "chrome_sandbox")
    : "<playwright-chromium>/chrome-linux/chrome_sandbox"
  const fix = [
    `Chromium cannot start because its sandbox is not permitted: ${message}`,
    `Fix the sandbox helper: sudo chown root:root ${sandbox} && sudo chmod 4755 ${sandbox}`,
    "Or allow unprivileged user namespaces: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
    "Or install Google Chrome so the browser uses system Chrome. The sandbox is never disabled.",
  ].join("\n")
  return new UnavailableError(fix, fix)
}

function output() {
  return path.join(Global.Path.data, "browser", "output")
}

/** The Chromium build of the bundled playwright-core, when it is installed. */
async function chromium() {
  const mod = await import("playwright-core")
  return mod.chromium.executablePath()
}

async function target(): Promise<Target> {
  const located = locate({
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    exists: existsSync,
    chromium: await chromium(),
  })
  if (!located) throw new UnavailableError(INSTALL_HINT, `No browser found. Install Chromium with ${INSTALL_HINT}`)
  return located
}

function blocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((item): ContentBlock[] => {
    if (typeof item !== "object" || item === null) return []
    if (!("type" in item)) return []
    if (item.type === "text" && "text" in item && typeof item.text === "string")
      return [{ type: "text", text: item.text }]
    if (item.type === "image" && "data" in item && typeof item.data === "string") {
      const mime = "mimeType" in item && typeof item.mimeType === "string" ? item.mimeType : "image/png"
      return [{ type: "image", data: item.data, mimeType: mime }]
    }
    return []
  })
}

/**
 * Read a snapshot file the Playwright MCP wrote, and nothing else. Tool output is page-controlled:
 * a page could make `browser_evaluate` print `- [Snapshot](/etc/passwd)`, so only files that resolve
 * inside the output directory the backend owns are read, and only up to `INLINE_LIMIT` bytes.
 */
async function readSnapshot(file: string): Promise<string | undefined> {
  const root = await fs.realpath(output()).catch(() => undefined)
  if (!root) return undefined
  const resolved = await fs.realpath(path.resolve(root, file)).catch(() => undefined)
  if (!resolved || (resolved !== root && !resolved.startsWith(root + path.sep))) return undefined
  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile() || stat.size > INLINE_LIMIT) return undefined
  return fs.readFile(resolved, "utf8").catch(() => undefined)
}

/**
 * Playwright MCP writes an action's page snapshot to a file and returns `- [Snapshot](path)`.
 * The model needs the snapshot itself: read the file back so every observation mode sees the page.
 */
async function inline(text: string): Promise<string> {
  const lines = text.split("\n")
  const out: string[] = []
  for (const line of lines) {
    const match = /^- \[Snapshot\]\((.+)\)$/.exec(line.trim())
    if (!match) {
      out.push(line)
      continue
    }
    const body = await readSnapshot(match[1])
    if (body === undefined) {
      out.push(line)
      continue
    }
    out.push("```yaml", ...body.replace(/\n$/, "").split("\n"), "```")
  }
  return out.join("\n")
}

type Connection = {
  client: Client
  server: Server
  browser: Browser
  context: BrowserContext
  tools: Entry[]
  sha: string
}

/**
 * The Playwright MCP package and its browser stack are loaded on the first browser call, not on CLI
 * start: together they add megabytes to a session that may never open a browser.
 */
async function connect(browser: Settings): Promise<Connection> {
  const out = output()
  await fs.mkdir(out, { recursive: true })
  const located = await target()
  const { chromium } = await import("playwright-core")
  const mcp = await import("@playwright/mcp")
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")

  // An in-memory profile: two Kilo processes (the CLI and the extension's `kilo serve`, or two VS
  // Code windows) never contend for one Chrome profile on disk, and a crashed process leaves no
  // profile or SingletonLock behind. The context lives as long as this backend, so cookies and
  // storage still survive between tool calls in one process.
  const instance = await chromium
    .launch({
      headless: browser.headless,
      handleSIGINT: false,
      handleSIGTERM: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      ...located,
    })
    .catch((error) => {
      throw launchFailure(error, "executablePath" in located ? located.executablePath : undefined)
    })
  let server: Server | undefined
  let client: Client | undefined
  try {
    const context = await instance.newContext()
    server = await mcp.createConnection({ browser: { browserName: "chromium", isolated: false }, outputDir: out }, () =>
      Promise.resolve(context),
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: "kilo", version: BrowserContract.upstream })
    await client.connect(clientTransport)
    const listed = await client.listTools()
    const live = readEntries(listed)

    // The pinned hash covers the raw stdio tools/list JSON, which the client re-serializes. Compare
    // the normalized tool list instead: same tools, same schemas, same read-only hints.
    if (readHash(live) !== readHash(BrowserContract.entries)) {
      log.warn("bundled playwright MCP contract differs from the pinned contract", {
        expected: BrowserContract.sha256,
      })
    }
    // Keep the model-facing list identical to the vendored contract, on the tools this build has.
    const available = new Set(live.map((tool) => tool.name))
    const tools: Entry[] = BrowserContract.entries.filter((tool) => available.has(tool.name))

    return { client, server, browser: instance, context, tools, sha: BrowserContract.sha256 }
  } catch (error) {
    await client?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
    await instance.close().catch(() => undefined)
    throw error
  }
}

class PlaywrightBackend implements Backend {
  readonly id = "playwright" as const

  private disposed = false
  private readonly off: Array<() => void> = []

  private constructor(
    private readonly conn: Connection,
    readonly contractSha: string,
    readonly tools: readonly Entry[],
    private readonly onClosed: () => void,
  ) {
    // A crashed browser fires `disconnected`; the cache must not keep handing out a dead backend.
    const gone = () => {
      this.onClosed()
      void this.dispose()
    }
    this.conn.browser.on("disconnected", gone)
    this.conn.context.on("close", gone)
    this.off.push(
      () => this.conn.browser.off("disconnected", gone),
      () => this.conn.context.off("close", gone),
    )
  }

  static async create(browser: Settings, onClosed: () => void) {
    const conn = await connect(browser)
    return new PlaywrightBackend(conn, conn.sha, conn.tools, onClosed)
  }

  async call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    const result = await this.conn.client.callTool({ name, arguments: args }, undefined, {
      timeout: TIMEOUT,
      signal: ctx.signal,
    })
    const content = blocks(result.content)
    for (const block of content) if (block.type === "text") block.text = await inline(block.text)
    if (!content.length && result.structuredContent !== undefined) {
      content.push({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) })
    }
    return { content, isError: result.isError === true }
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.off) off()
    await this.conn.client.close().catch(() => undefined)
    await this.conn.server.close().catch(() => undefined)
    await this.conn.browser.close().catch(() => undefined)
  }
}

type CacheEntry = { backend?: Backend; promise: Promise<Backend> }

const cache = new Map<string, CacheEntry>()

function evict(key: string, entry: CacheEntry) {
  if (cache.get(key) === entry) cache.delete(key)
}

let shutdownRegistered = false

function registerShutdown() {
  if (shutdownRegistered) return
  shutdownRegistered = true
  KiloShutdown.register(async () => {
    const entries = Array.from(cache.values())
    cache.clear()
    await Promise.all(entries.map((entry) => entry.backend?.dispose()))
  })
}

/** Dispose every cached browser, for example when `browser.backend` switches to `off`. */
export async function disposePlaywright() {
  const entries = Array.from(cache.values())
  cache.clear()
  await Promise.all(entries.map((entry) => entry.backend?.dispose()))
}

/** One browser process per distinct Playwright configuration, shared by every session in the process. */
export function playwright(browser: Settings): Promise<Backend> {
  const key = JSON.stringify({
    backend: browser.backend,
    target: browser.target,
    headless: browser.headless,
  })
  const existing = cache.get(key)
  if (existing) return existing.promise
  const entry: CacheEntry = { promise: Promise.resolve(undefined as unknown as Backend) }
  entry.promise = PlaywrightBackend.create(browser, () => evict(key, entry)).then(
    (instance) => {
      entry.backend = instance
      return instance
    },
    (error) => {
      evict(key, entry)
      throw error
    },
  )
  cache.set(key, entry)
  registerShutdown()
  return entry.promise
}
