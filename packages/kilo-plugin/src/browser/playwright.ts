import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Client, Transport } from "@modelcontextprotocol/client"
import type { Browser, BrowserContext } from "playwright-core"
import { Global } from "@opencode/util/global"
import {
  UnsupportedError,
  type BrowserBackend,
  type CallContext,
  type CallResult,
  type ContentBlock,
} from "./backend"
import { BrowserContract } from "./contract"
import { entries as readEntries } from "./contract-shape"
import type { Entry } from "./contract-shape"
import { INSTALL_HINT, locate, type Target } from "./locate"
import { useKiloBrowsers } from "./install"
import type { Settings } from "./settings"

/** A long action (a slow page, a download) still ends: the MCP call is bounded, and the session abort wins earlier. */
const TIMEOUT = 180_000

/** Snapshots are page content: inline them, but never read more than this from disk. */
const INLINE_LIMIT = 2 * 1024 * 1024

export function outputDirectory() {
  return path.join(Global.Path.data, "browser", "output")
}

/**
 * Chrome on Ubuntu refuses to start when its sandbox helper is not setuid or unprivileged user namespaces are
 * restricted. Name the fix instead of surfacing a raw launch stack, and never paper over it by disabling the sandbox.
 */
export function launchFailure(error: unknown, executable?: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (!/sandbox/i.test(message)) return error instanceof Error ? error : new Error(message)
  const sandbox = executable
    ? path.join(path.dirname(executable), "chrome_sandbox")
    : "<playwright-chromium>/chrome-linux/chrome_sandbox"
  return new Error(
    [
      `Chromium cannot start because its sandbox is not permitted: ${message}`,
      `Fix the sandbox helper: sudo chown root:root ${sandbox} && sudo chmod 4755 ${sandbox}`,
      "Or allow unprivileged user namespaces: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
      "Or install Google Chrome so the browser uses system Chrome. The sandbox is never disabled.",
    ].join("\n"),
  )
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
 * Read a snapshot file the Playwright MCP wrote, and nothing else. Tool output is page-controlled: a page could make
 * `browser_evaluate` print `- [Snapshot](/etc/passwd)`, so only files that resolve inside the output directory the
 * backend owns are read, and only up to `INLINE_LIMIT` bytes.
 */
async function readSnapshot(file: string): Promise<string | undefined> {
  const root = await fs.realpath(outputDirectory()).catch(() => undefined)
  if (!root) return undefined
  const resolved = await fs.realpath(path.resolve(root, file)).catch(() => undefined)
  if (!resolved || (resolved !== root && !resolved.startsWith(root + path.sep))) return undefined
  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile() || stat.size > INLINE_LIMIT) return undefined
  return fs.readFile(resolved, "utf8").catch(() => undefined)
}

/**
 * Playwright MCP writes an action's page snapshot to a file and returns `- [Snapshot](path)`. The model needs the
 * snapshot itself, so every observation mode sees the page.
 */
async function inline(text: string): Promise<string> {
  const out: string[] = []
  for (const line of text.split("\n")) {
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

/** What `@playwright/mcp` returns: an MCP 1.x server bundled inside playwright-core. */
type PlaywrightServer = { connect(transport: Transport): Promise<void>; close(): Promise<void> }

type Connection = {
  client: Client
  server: PlaywrightServer
  browser: Browser
  context: BrowserContext
  tools: readonly Entry[]
}

/**
 * A linked in-memory transport pair. The server `@playwright/mcp` hands back comes from the MCP SDK bundled in
 * playwright-core (1.x), while the CLI's own client is `@modelcontextprotocol/client` (2.x); both speak JSON-RPC over
 * the same three-method transport surface, so one pair joins them without a second SDK in the build.
 */
function linked(): [Transport, Transport] {
  const sides: { left?: Transport; right?: Transport } = {}
  const endpoint = (other: () => Transport | undefined): Transport => ({
    start: async () => {},
    send: async (message) => void other()?.onmessage?.(message),
    close: async () => other()?.onclose?.(),
  })
  sides.left = endpoint(() => sides.right)
  sides.right = endpoint(() => sides.left)
  return [sides.left, sides.right]
}

/**
 * The Chromium build of playwright-core is the last choice: system Chrome first, then Edge. An installed build under
 * the Kilo data dir is found through `PLAYWRIGHT_BROWSERS_PATH`, which the install command and this backend both set
 * before playwright-core is imported (its registry reads the variable once, at import).
 */
async function target(settings: Settings, chromium: string): Promise<Target> {
  const located = locate({
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    exists: existsSync,
    chromium,
  })
  if (located) return located
  throw new Error(`No browser found. Install Chromium with \`${INSTALL_HINT}\`, or install Google Chrome or Microsoft Edge.`)
}

/**
 * The browser is launched here, not by the MCP server, so the provider owns the process and the in-memory profile:
 * two Kilo processes never contend for one Chrome profile on disk, and a crash leaves no profile or SingletonLock.
 */
async function connect(settings: Settings): Promise<Connection> {
  const out = outputDirectory()
  await fs.mkdir(out, { recursive: true })
  // playwright-core and the MCP server are megabytes of parse work on a session that may never open a browser, and
  // this module is in the CLI's startup graph, so they load on the first browser call. The browser directory is read
  // once, at that import, so it must be set here.
  useKiloBrowsers()
  const { chromium } = await import("playwright-core")
  const mcp = await import("@playwright/mcp")
  const sdk = await import("@modelcontextprotocol/client")

  const located = await target(settings, chromium.executablePath())
  const browser = await chromium
    .launch({
      headless: settings.headless,
      handleSIGINT: false,
      handleSIGTERM: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      ...located,
    })
    .catch((error) => {
      throw launchFailure(error, "executablePath" in located ? located.executablePath : undefined)
    })
  let server: PlaywrightServer | undefined
  let client: Client | undefined
  try {
    const context = await browser.newContext()
    server = (await mcp.createConnection(
      { browser: { browserName: "chromium", isolated: false }, outputDir: out },
      () => Promise.resolve(context),
    )) as unknown as PlaywrightServer
    const [clientTransport, serverTransport] = linked()
    await server.connect(serverTransport)
    client = new sdk.Client({ name: "kilo", version: BrowserContract.upstream })
    await client.connect(clientTransport)
    const listed = await client.listTools()
    const live = readEntries(listed)
    // Keep the model-facing list identical to the vendored contract, on the tools this build has.
    const available = new Set(live.map((tool) => tool.name))
    const tools = BrowserContract.entries.filter((tool) => available.has(tool.name))
    return { client, server, browser, context, tools }
  } catch (error) {
    await client?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    throw error
  }
}

/** The URL the last result reported, so a call reaches the page MCP acted on before it saw a new tab. */
class PlaywrightBackend implements BrowserBackend {
  readonly id = "playwright" as const
  readonly contractSha = BrowserContract.sha256
  private readonly off: Array<() => void> = []
  private disposed = false

  private constructor(
    private readonly conn: Connection,
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

  static async create(settings: Settings, onClosed: () => void) {
    return new PlaywrightBackend(await connect(settings), onClosed)
  }

  async listTools() {
    return this.conn.tools
  }

  async callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    // Running code in the CLI process is not a browser action we can bound, so this backend refuses it.
    if (name === "browser_run_code_unsafe") throw new UnsupportedError()
    const result = await this.conn.client.callTool({ name, arguments: args }, { timeout: TIMEOUT, signal: ctx.signal })
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

type EntryState = { promise: Promise<BrowserBackend>; backend?: BrowserBackend }

/**
 * One browser process per distinct configuration, shared by every session in the process. A backend that lost its
 * browser evicts itself, so the next call launches a new one; `dispose` closes every live browser, which the tool
 * plugin runs from an Effect finalizer when the location shuts down.
 */
export class Backends {
  private readonly entries = new Map<string, EntryState>()

  constructor(private readonly create: (key: string, evict: () => void) => Promise<BrowserBackend>) {}

  get(key: string): Promise<BrowserBackend> {
    const existing = this.entries.get(key)
    if (existing) return existing.promise
    const entry: EntryState = { promise: Promise.resolve(undefined as unknown as BrowserBackend) }
    const evict = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
    entry.promise = this.create(key, evict).then(
      (backend) => {
        entry.backend = backend
        return backend
      },
      (error) => {
        evict()
        throw error
      },
    )
    this.entries.set(key, entry)
    return entry.promise
  }

  async dispose() {
    const values = Array.from(this.entries.values())
    this.entries.clear()
    await Promise.all(values.map((entry) => entry.backend?.dispose()))
  }
}

export function key(settings: Settings) {
  return JSON.stringify({ backend: settings.backend, target: settings.target, headless: settings.headless })
}

/** The process-wide browser pool of the bundled Playwright backend. */
export const playwright = new Backends((value, evict) =>
  PlaywrightBackend.create(JSON.parse(value) as Settings, evict),
)
