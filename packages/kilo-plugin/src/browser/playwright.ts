// The bundled Playwright backend. `playwright-core` and the pinned `@playwright/mcp` both run inside this process:
// this build of playwright-core is the bundled one whose entry point is already in-process, so the CLI needs no
// `npx`, no Node and no driver subprocess to drive a browser. `@playwright/mcp` exposes `createConnection`, so the
// backend hands it a context it launched itself and talks MCP to it over an in-memory transport.
//
// The browser is one of: a system Chrome or Edge channel, or the Chromium that this playwright-core build downloads.
// The context lives as long as this process, in memory: two Kilo processes never contend for one profile, and a
// crash leaves no profile or SingletonLock behind.
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Client, Transport } from "@modelcontextprotocol/client"
import type { Browser, BrowserContext } from "playwright-core"
import { Global } from "@opencode/util/global"

/** How Kilo starts the browser: a system channel, or the Playwright-installed Chromium build. */
export type Target = { channel: "chrome" | "msedge" } | { executablePath: string }

export const INSTALL_HINT = "npx @playwright/mcp@0.0.81 install-browser"

const win = path.win32

function chromePaths(home: string, env: Record<string, string | undefined>, platform: NodeJS.Platform) {
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
  if (platform === "win32")
    return [
      env["PROGRAMFILES"] && win.join(env["PROGRAMFILES"], "Google/Chrome/Application/chrome.exe"),
      env["PROGRAMFILES(X86)"] && win.join(env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
      env["LOCALAPPDATA"] && win.join(env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
    ]
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"]
}

function edgePaths(home: string, env: Record<string, string | undefined>, platform: NodeJS.Platform) {
  if (platform === "darwin")
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]
  if (platform === "win32")
    return [
      env["PROGRAMFILES"] && win.join(env["PROGRAMFILES"], "Microsoft/Edge/Application/msedge.exe"),
      env["PROGRAMFILES(X86)"] && win.join(env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      env["LOCALAPPDATA"] && win.join(env["LOCALAPPDATA"], "Microsoft/Edge/Application/msedge.exe"),
    ]
  return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"]
}

/**
 * System Chrome first, then Edge, then the Playwright-installed Chromium of the bundled playwright-core. The
 * caller applies a Kilo-owned context; the user's own browser profile is never used.
 */
export function locate(input: {
  platform: NodeJS.Platform
  home: string
  env: Record<string, string | undefined>
  exists: (candidate: string) => boolean
  chromium?: string
}): Target | undefined {
  const found = (candidates: (string | undefined)[]) =>
    candidates.filter((candidate): candidate is string => candidate !== undefined).some(input.exists)
  if (found(chromePaths(input.home, input.env, input.platform))) return { channel: "chrome" }
  if (found(edgePaths(input.home, input.env, input.platform))) return { channel: "msedge" }
  if (input.chromium && input.exists(input.chromium)) return { executablePath: input.chromium }
  return undefined
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
      "Or allow unprivileged user namespaces: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1",
      "Or install Google Chrome so the browser uses system Chrome. The sandbox is never disabled.",
    ].join("\n"),
  )
}

/** Snapshots are page content: inline them, but never read more than this from disk. */
const INLINE_LIMIT = 2 * 1024 * 1024

const OUTPUT_DIR = path.join(Global.Path.data, "browser", "output")

type Connection = {
  client: Client
  server: PlaywrightServer
  browser: Browser
  context: BrowserContext
}

/** What `@playwright/mcp` returns: an MCP SDK 1.x server, bundled inside playwright-core. */
type PlaywrightServer = { connect(transport: Transport): Promise<void>; close(): Promise<void> }

let connection: Promise<Connection> | undefined

/**
 * A linked in-memory transport pair. The MCP server that `@playwright/mcp` hands back comes from the SDK bundled in
 * playwright-core (1.x), while the CLI's own MCP client is `@modelcontextprotocol/client` (2.x); both speak JSON-RPC
 * over the same three-method transport surface, so one pair joins them without a second SDK in the build.
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
 * Read a file the Playwright MCP wrote, and nothing else. Tool output is page-controlled: a page could make
 * `browser_evaluate` print `- [Snapshot](/etc/passwd)`, so only files that resolve inside the output directory the
 * backend owns are read, and only up to `INLINE_LIMIT` bytes.
 */
async function readSnapshot(file: string): Promise<string | undefined> {
  const root = await fs.realpath(OUTPUT_DIR).catch(() => undefined)
  if (!root) return undefined
  const resolved = await fs.realpath(path.resolve(root, file)).catch(() => undefined)
  if (!resolved || (resolved !== root && !resolved.startsWith(root + path.sep))) return undefined
  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile() || stat.size > INLINE_LIMIT) return undefined
  return fs.readFile(resolved, "utf8").catch(() => undefined)
}

/**
 * Playwright MCP writes an action's page snapshot to a file and returns `- [Snapshot](path)`. The model needs the
 * snapshot itself, so read the file back and inline it.
 */
async function inline(text: string): Promise<string> {
  const lines = await Promise.all(
    text.split("\n").map(async (line) => {
      const match = /^- \[Snapshot\]\((.+)\)$/.exec(line.trim())
      if (!match) return [line]
      const body = await readSnapshot(match[1])
      if (body === undefined) return [line]
      return ["```yaml", ...body.replace(/\n$/, "").split("\n"), "```"]
    }),
  )
  return lines.flat().join("\n")
}

async function connect(): Promise<Connection> {
  // Dynamic imports: playwright-core and the MCP server are megabytes of parse work on a session that may never
  // open a browser, and this module is in the CLI's startup graph (AGENTS.md: "Prefer dynamic imports for heavy
  // modules that are only needed in selected code paths"). A static import would load them for every CLI start.
  const { chromium } = await import("playwright-core")
  const mcp = await import("@playwright/mcp")
  const sdk = await import("@modelcontextprotocol/client")
  const out = OUTPUT_DIR
  await fs.mkdir(out, { recursive: true })
  const located = locate({
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    exists: existsSync,
    chromium: chromium.executablePath(),
  })
  if (!located)
    throw new Error(`No browser found. Install Chromium with ${INSTALL_HINT}, or install Google Chrome or Microsoft Edge.`)
  const browser = await chromium
    .launch({
      headless: process.env.KILO_BROWSER_HEADLESS !== "0",
      handleSIGINT: false,
      handleSIGTERM: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      ...located,
    })
    .catch((error) => {
      throw launchFailure(error, "executablePath" in located ? located.executablePath : undefined)
    })
  try {
    const context = await browser.newContext()
    const server = (await mcp.createConnection(
      { browser: { browserName: "chromium", isolated: false }, outputDir: out },
      () => Promise.resolve(context),
    )) as unknown as PlaywrightServer
    const [clientTransport, serverTransport] = linked()
    await server.connect(serverTransport)
    const client = new sdk.Client({ name: "kilo", version: "0.0.0" })
    await client.connect(clientTransport)
    return { client, server, browser, context }
  } catch (error) {
    await browser.close().catch(() => undefined)
    throw error
  }
}

function text(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) return ""
  if (!Array.isArray(result.content)) return ""
  return result.content
    .flatMap((item): string[] => {
      if (typeof item !== "object" || item === null || !("type" in item)) return []
      return item.type === "text" && "text" in item && typeof item.text === "string" ? [item.text] : []
    })
    .join("\n")
}

/** Call one Playwright MCP tool on the shared browser, with the snapshot files already inlined. */
export async function call(name: string, args: Record<string, unknown>) {
  const current = (connection ??= connect())
  const { client } = await current.catch((error) => {
    connection = undefined
    throw error
  })
  try {
    const result: unknown = await client.callTool({ name, arguments: args })
    const body = text(result)
    const failed = typeof result === "object" && result !== null && "isError" in result && result.isError === true
    if (failed) throw new Error(body || `${name} failed`)
    return await inline(body)
  } catch (error) {
    // A closed browser leaves a dead client behind; the next call starts a new one.
    reset()
    throw error
  }
}

/** Drop the shared connection. The next call launches a new browser. */
function reset() {
  const current = connection
  connection = undefined
  void current?.then(async (value) => {
    await value.client.close().catch(() => undefined)
    await value.server.close().catch(() => undefined)
    await value.browser.close().catch(() => undefined)
  })
}

/**
 * `browser_navigate`, then the page snapshot. The navigate result alone points at the snapshot file; the model needs
 * the tree, so this is the pair the contract's `browser_navigate` followed by `browser_snapshot` produces.
 */
export async function navigate(url: string) {
  const first = await call("browser_navigate", { url })
  const snapshot = await call("browser_snapshot", {})
  return [first, snapshot].filter(Boolean).join("\n\n")
}
