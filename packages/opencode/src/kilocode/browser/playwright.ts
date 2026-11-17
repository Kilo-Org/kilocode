import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { existsSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { Browser, BrowserContext, Download, Frame, Page } from "playwright-core"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import type { Entry } from "./contract-shape"
import { entries as readEntries, hash as readHash } from "./contract-shape"
import { NeedsPermissionError, UnavailableError } from "./backend"
import type { Backend, CallResult, CallContext, ContentBlock } from "./backend"
import { BrowserContract } from "./contract"
import * as Frames from "./frames"
import { BrowserItems } from "./items"
import { INSTALL_HINT, locate } from "./locate"
import type { Target } from "./locate"
import * as Png from "./png"
import { BrowserPermission } from "./permission"
import type { Settings } from "./settings"

type Item = BrowserPermission.Item

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

/** The bundled Chromium build of playwright-core, when it is installed. */
async function chromiumPath() {
  const mod = await import("playwright-core")
  return mod.chromium.executablePath()
}

async function target(): Promise<Target> {
  const located = locate({
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    exists: existsSync,
    chromium: await chromiumPath(),
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
 * Sensitive step tokens. A token binds the tool, its arguments and the origin, and
 * expires after a minute, so an approval can only replay the exact step it was asked for.
 */
const STEPS = new Map<string, { hash: string; expires: number; origin: string }>()
const STEP_TTL = 60_000
const STEP_LIMIT = 200

function stepHash(tool: string, args: Record<string, unknown>, origin: string) {
  return createHash("sha256").update(JSON.stringify({ tool, args, origin })).digest("hex")
}

function approveStep(tool: string, args: Record<string, unknown>, origin: string) {
  const now = Date.now()
  for (const [token, step] of STEPS) if (step.expires < now) STEPS.delete(token)
  while (STEPS.size >= STEP_LIMIT) {
    const oldest = STEPS.keys().next().value
    if (oldest === undefined) break
    STEPS.delete(oldest)
  }
  const token = randomUUID()
  STEPS.set(token, { hash: stepHash(tool, args, origin), expires: now + STEP_TTL, origin })
  return token
}

function stepApproved(tokens: readonly string[], tool: string, args: Record<string, unknown>, origin: string) {
  const hash = stepHash(tool, args, origin)
  return tokens.some((token) => {
    const step = STEPS.get(token)
    if (!step) return false
    if (step.expires < Date.now()) {
      STEPS.delete(token)
      return false
    }
    return step.hash === hash
  })
}

/** Hosts whose consent screens hand a session to another service. */
const OAUTH_HOST: Record<string, true> = {
  "accounts.google.com": true,
  "login.microsoftonline.com": true,
  "login.live.com": true,
  "appleid.apple.com": true,
  "github.com": true,
  "gitlab.com": true,
  "id.atlassian.com": true,
  "login.salesforce.com": true,
  "auth0.com": true,
  "login.okta.com": true,
}

const OAUTH_PATH = /oauth|authorize|consent|signin-oidc|saml/i

function oauthConsent(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith(".okta.com")) return OAUTH_PATH.test(parsed.pathname)
    return OAUTH_HOST[parsed.hostname] === true && OAUTH_PATH.test(parsed.pathname)
  } catch {
    return false
  }
}

/** Runs inside the page: classifies the element a step acts on. */
function inspectElement(el: Element, kind: "fill" | "click") {
  const attr = (name: string) => (el.getAttribute(name) || "").toLowerCase()
  if (kind === "fill") {
    const type = ((el as HTMLInputElement).type || "").toLowerCase()
    const autocomplete = attr("autocomplete")
    if (type === "password") return "password field"
    if (autocomplete === "one-time-code") return "one-time code field"
    if (autocomplete.startsWith("cc-")) return "payment field (" + autocomplete + ")"
    return ""
  }
  const card = (node: Element) => {
    const input = node as HTMLInputElement
    if ((node.getAttribute("autocomplete") || "").toLowerCase().startsWith("cc-")) return true
    const hint = [input.name, input.id, node.getAttribute("placeholder"), node.getAttribute("aria-label")]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ")
    return /card|credit|cvv|cvc|expir/i.test(hint)
  }
  const form = el.closest("form")
  if (!form) return ""
  const submit =
    (el.tagName === "INPUT" && (attr("type") === "submit" || attr("type") === "image")) ||
    (el.tagName === "BUTTON" && (attr("type") === "" || attr("type") === "submit"))
  if (submit && Array.from(form.querySelectorAll("input")).some(card)) return "submit on a payment form"
  return ""
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
 * start: together they add megabytes to a session that may never open a browser. The browser is
 * launched here, not by the MCP server, so the provider can read the frame tree, measure frames and
 * mask pixels before results leave the backend.
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

/** Frames whose origin has no `read` grant, outermost first; a withheld frame hides its subtree. */
function withheldFrames(page: Page, authorized: readonly string[]): Frame[] {
  const result: Frame[] = []
  const visit = (frame: Frame, granted: boolean) => {
    for (const child of frame.childFrames()) {
      const origin = BrowserPermission.origin(child.url())
      // about:blank and srcdoc frames inherit the parent: they hold no other origin's data.
      const ok = granted && (origin === undefined || authorized.includes(`read:${origin}`))
      if (!ok) {
        result.push(child)
        continue
      }
      visit(child, true)
    }
  }
  visit(page.mainFrame(), true)
  return result
}

class PlaywrightBackend implements Backend {
  readonly id = "playwright" as const
  private url: string | undefined

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

  /** The page MCP is acting on: the one whose URL the last result reported. */
  private current(): Page | undefined {
    const pages = this.conn.context.pages()
    if (!pages.length) return undefined
    const match = this.url ? pages.findLast((page) => page.url() === this.url) : undefined
    return match ?? pages[pages.length - 1]
  }

  /** The frame a `[ref=…]` snapshot ref lives in, resolved through Playwright's aria-ref engine. */
  private async frameOf(page: Page, ref: string): Promise<Frame | undefined> {
    const handle = await page
      .locator(`aria-ref=${ref}`)
      .elementHandle({ timeout: 2_000 })
      .catch(() => null)
    if (!handle) return undefined
    // An iframe ref points at the frame element in its parent; the grant belongs to the
    // document it contains, so prefer the child frame when there is one.
    const child = await handle.contentFrame().catch(() => null)
    const frame = child ?? (await handle.ownerFrame())
    handle.dispose()
    return frame ?? undefined
  }

  private async inspect(page: Page, ref: string, kind: "fill" | "click"): Promise<string> {
    const handle = await page
      .locator(`aria-ref=${ref}`)
      .elementHandle({ timeout: 2_000 })
      .catch(() => null)
    if (!handle) return ""
    const reason = await handle.evaluate(inspectElement, kind).catch(() => "")
    handle.dispose()
    return typeof reason === "string" ? reason : ""
  }

  private async sensitive(name: string, args: Record<string, unknown>, page: Page): Promise<string[]> {
    const reasons: string[] = []
    if (oauthConsent(page.url())) reasons.push("OAuth sign-in page")
    if (name === "browser_file_upload" || name === "browser_drop") reasons.push("file upload")
    if (name === "browser_type" || name === "browser_click" || name === "browser_fill_form") {
      const refs: string[] = []
      if (typeof args.target === "string") refs.push(args.target)
      if (Array.isArray(args.fields)) {
        for (const field of args.fields) {
          if (typeof field === "object" && field !== null && "target" in field && typeof field.target === "string") {
            refs.push(field.target)
          }
        }
      }
      const kind = name === "browser_click" ? "click" : "fill"
      for (const ref of refs) {
        const reason = await this.inspect(page, ref, kind)
        if (reason) reasons.push(reason)
      }
    }
    return [...new Set(reasons)]
  }

  /** Refs of every iframe node in a snapshot text, with the origin of the frame they contain. */
  private async frameOrigins(page: Page, text: string) {
    const origins = new Map<string, string>()
    for (const node of Frames.iframes(text)) {
      const handle = await page
        .locator(`aria-ref=${node.ref}`)
        .elementHandle({ timeout: 2_000 })
        .catch(() => null)
      if (!handle) continue
      const frame = await handle.contentFrame().catch(() => null)
      handle.dispose()
      const origin = frame && BrowserPermission.origin(frame.url())
      if (origin) origins.set(node.ref, origin)
    }
    return origins
  }

  private async filter(page: Page, name: string, text: string, authorized: readonly string[]) {
    const withheld = withheldFrames(page, authorized)
    if (!withheld.length) return text
    const origins = new Set(
      withheld.map((frame) => BrowserPermission.origin(frame.url())).filter((origin): origin is string => !!origin),
    )
    let next = text
    if (next.includes("### Snapshot")) {
      // Best effort: a ref that does not resolve to a frame keeps its subtree.
      const withheld = await this.frameOrigins(page, next)
      next = Frames.snapshot(next, withheld, (origin) => authorized.includes(`read:${origin}`))
    }
    if (name === "browser_console_messages") next = Frames.consoleMessages(next, origins)
    if (name === "browser_network_requests") next = Frames.networkRequests(next, origins)
    return next
  }

  /** Mask boxes for withheld frames, in CSS pixels of the screenshot. */
  private async maskBoxes(page: Page, frames: Frame[], fullPage: boolean) {
    const scroll = fullPage
      ? await page.mainFrame().evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      : { x: 0, y: 0 }
    const boxes: Png.Box[] = []
    for (const frame of frames) {
      const handle = await frame.frameElement().catch(() => null)
      if (!handle) throw new Error("a withheld frame could not be measured")
      const box = await handle.boundingBox()
      handle.dispose()
      if (!box) continue // a frame with no box paints no pixels
      boxes.push({ x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height })
    }
    return boxes
  }

  private async outputFiles() {
    return new Set(await fs.readdir(output()).catch(() => []))
  }

  private async removeNewFiles(before: ReadonlySet<string>) {
    const after = await this.outputFiles()
    for (const name of after) {
      if (before.has(name)) continue
      await fs.unlink(path.join(output(), name)).catch(() => {})
    }
  }

  async plan(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<Item[]> {
    const page = this.current()
    const elements: BrowserItems.Element[] = []
    if (page) {
      for (const ref of BrowserItems.refs(args)) {
        const frame = await this.frameOf(page, ref)
        const origin = frame && BrowserPermission.origin(frame.url())
        if (!frame || !origin) continue
        elements.push({ ref, origin, frame: frame !== page.mainFrame() })
      }
    }
    return BrowserItems.plan({
      tool: name,
      args,
      page: page && BrowserPermission.origin(page.url()),
      elements,
      authorized: ctx.authorized,
    })
  }

  async call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    let page = this.current()

    // Sensitive steps are classified on the live element, then approved one step at a time.
    if (page) {
      const reasons = await this.sensitive(name, args, page)
      const origin = BrowserPermission.origin(page.url())
      if (reasons.length && origin && !stepApproved(ctx.sensitive, name, args, origin)) {
        throw new NeedsPermissionError(
          [{ class: "sensitive", origin, reason: reasons.join("; ") }],
          approveStep(name, args, origin),
        )
      }
    }

    // A screenshot may not leave the backend with a withheld frame visible in pixels or file.
    const withheldBefore = page ? withheldFrames(page, ctx.authorized) : []
    const shot = name === "browser_take_screenshot"
    let callArgs = args
    if (shot && withheldBefore.length) {
      if (args.target !== undefined) {
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page is withheld." }],
          isError: true,
        }
      }
      callArgs = { ...args, type: "png", scale: "css" }
      delete callArgs.filename
    }
    const before = shot && withheldBefore.length ? await this.outputFiles() : undefined

    const downloads: string[] = []
    const onDownload = (download: Download) => {
      const origin = page && BrowserPermission.origin(page.url())
      if (origin && stepApproved(ctx.sensitive, name, args, origin)) return
      downloads.push(download.suggestedFilename())
      void download.cancel().catch(() => {})
    }
    type ToolCall = Awaited<ReturnType<Client["callTool"]>>
    let result: ToolCall
    this.conn.context.on("download", onDownload)
    try {
      result = await this.conn.client.callTool({ name, arguments: callArgs }, undefined, {
        timeout: TIMEOUT,
        signal: ctx.signal,
      })
      // A download starts alongside the action that triggers it; give the event a moment to surface.
      if (page && ["browser_click", "browser_drop", "browser_press_key", "browser_navigate"].includes(name)) {
        await page.waitForTimeout(150).catch(() => {})
      }
    } finally {
      this.conn.context.off("download", onDownload)
    }

    const content = blocks(result.content)
    for (const block of content) if (block.type === "text") block.text = await inline(block.text)
    if (!content.length && result.structuredContent !== undefined) {
      content.push({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) })
    }
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
    const reported = /^- Page URL: (.+)$/m.exec(text)?.[1]?.trim()
    if (reported) this.url = reported
    page = this.current()

    if (downloads.length) {
      const origin = page && BrowserPermission.origin(page.url())
      if (origin) {
        throw new NeedsPermissionError(
          [{ class: "sensitive", origin, reason: `download: ${downloads.join(", ")}` }],
          approveStep(name, args, origin),
        )
      }
    }

    // A navigation can land on another origin through a redirect; the real origin decides.
    if (page && (name === "browser_navigate" || name === "browser_navigate_back")) {
      const origin = BrowserPermission.origin(page.url())
      if (origin && !ctx.authorized.includes(`read:${origin}`) && !ctx.authorized.includes(`navigate:${origin}`)) {
        throw new NeedsPermissionError([{ class: "navigate", origin }])
      }
    }

    const withheld = page ? withheldFrames(page, ctx.authorized) : []
    const viewed = page ? await this.filter(page, name, text, ctx.authorized) : text
    const images = content.filter((block): block is Extract<ContentBlock, { type: "image" }> => block.type === "image")

    if (withheld.length && images.length && page) {
      const boxes = await this.maskBoxes(page, withheld, args.fullPage === true).catch(() => undefined)
      if (!boxes) {
        if (before) await this.removeNewFiles(before)
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page could not be masked." }],
          isError: true,
        }
      }
      try {
        for (const image of images) {
          if (image.mimeType !== "image/png") throw new Error("a screenshot that needs masking must be a PNG")
          const masked = Png.mask(Png.decode(Buffer.from(image.data, "base64")), boxes)
          image.data = Png.encode(masked).toString("base64")
          image.mimeType = "image/png"
        }
      } catch (error) {
        if (before) await this.removeNewFiles(before)
        log.warn("screenshot masking failed", { error: String(error) })
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page could not be masked." }],
          isError: true,
        }
      }
      // The file on disk was written before masking; it must not outlive the call.
      if (before) await this.removeNewFiles(before)
    }

    return {
      content: [{ type: "text", text: viewed }, ...images],
      isError: result.isError === true,
    }
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
