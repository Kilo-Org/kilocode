import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { CallToolResult, Client, Transport } from "@modelcontextprotocol/client"
import type { Browser, BrowserContext, Download, Frame, Page } from "playwright-core"
import { Global } from "@opencode/util/global"
import {
  NeedsPermissionError,
  UnsupportedError,
  type BrowserBackend,
  type CallContext,
  type CallMeta,
  type CallResult,
  type ContentBlock,
} from "./backend"
import { BrowserContract } from "./contract"
import { entries as readEntries } from "./contract-shape"
import type { Entry } from "./contract-shape"
import * as Frames from "./frames"
import { INSTALL_HINT, locate, type Target } from "./locate"
import { useKiloBrowsers } from "./install"
import { BrowserItems } from "./items"
import { BrowserPermission } from "./permission"
import * as Png from "./png"
import type { Settings } from "./settings"

type Item = BrowserPermission.Item

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
  // The instruction is a Linux one, so it keeps POSIX separators even when the test or a caller hands us a Windows path.
  const sandbox = executable
    ? `${executable.replace(/[\\/][^\\/]+$/, "")}/chrome_sandbox`
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
 * Sensitive step tokens. A token binds the tool, its arguments and the origin, and expires after a minute, so an
 * approval can only replay the exact step it was asked for.
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

export function oauthConsent(url: string) {
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
  throw new Error(
    `No browser found. Install Chromium with \`${INSTALL_HINT}\`, or install Google Chrome or Microsoft Edge.`,
  )
}

/**
 * The browser is launched here, not by the MCP server, so the provider owns the process and the in-memory profile:
 * two Kilo processes never contend for one Chrome profile on disk, and a crash leaves no profile or SingletonLock.
 * Owning the page is also what lets the backend read the frame tree, measure frames and mask pixels.
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

/** Frames whose origin has no `read` grant, outermost first; a withheld frame hides its subtree. */
export function withheldFrames(page: Page, authorized: readonly string[]): Frame[] {
  const result: Frame[] = []
  const visit = (frame: Frame, granted: boolean) => {
    for (const child of frame.childFrames()) {
      const origin = frameOrigin(child)
      // A frame whose origin cannot be determined is never granted.
      const ok = granted && origin !== undefined && authorized.includes(`read:${origin}`)
      if (!ok) result.push(child)
      // A withheld frame withholds every descendant, whatever the descendant's own origin.
      visit(child, ok)
    }
  }
  visit(page.mainFrame(), true)
  return result
}

/**
 * The origin a frame's document belongs to. `about:blank` and `srcdoc` frames inherit their parent's origin, so a
 * frame without one of its own is attributed to the nearest ancestor that has one.
 */
export function frameOrigin(frame: Pick<Frame, "url" | "parentFrame">): string | undefined {
  let current: Pick<Frame, "url" | "parentFrame"> | null = frame
  while (current) {
    const own = current.url().trim()
    // Only a document that inherits its parent's origin walks up: an opaque document (`data:`, `blob:`) does not, and
    // a withheld ancestor must not lend its grant to it.
    if (!INHERITS.test(own)) return BrowserPermission.origin(own)
    current = current.parentFrame()
  }
  return undefined
}

/** Documents that inherit the origin of the document that created them. */
const INHERITS = /^about:(blank|srcdoc)$/i

/** The URLs a call asks the browser to open: a navigation, or a new tab. */
export function navigationTargets(name: string, args: Record<string, unknown>): string[] {
  if (name === "browser_navigate" && typeof args.url === "string") return [args.url]
  if (name === "browser_tabs" && args.action === "new" && typeof args.url === "string") return [args.url]
  return []
}

/** The empty document a tab starts in; it carries no origin and no page data. */
const ABOUT_BLANK = "about:blank"

/**
 * Why a navigation target is refused, or undefined when it may proceed. Only http(s) pages carry an origin the
 * permission system can grant, and `about:blank` is the browser's empty document. Every other scheme — `file:`,
 * `data:`, `javascript:`, `chrome:`, `view-source:` — would read the local machine or run in the browser's own
 * context, so it never reaches the page, whether it is the requested URL or a redirect's landing page.
 */
export function navigationRefusal(url: string): string | undefined {
  const target = url.trim()
  if (target === ABOUT_BLANK) return undefined
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return `Navigation refused: "${target}" is not a URL the browser can open.`
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return undefined
  return `Navigation refused: ${parsed.protocol} URLs are not allowed. The browser opens http(s) pages and about:blank only.`
}

/**
 * Whether a call's output directory must be baselined before it runs. The withheld frame set is only final after the
 * call, and every result that can reach the output directory as a file must still be removable afterwards, so the
 * baseline never depends on a frame being withheld before the call.
 */
export function outputBaseline(name: string): boolean {
  return (
    name === "browser_take_screenshot" ||
    name === "browser_snapshot" ||
    name === "browser_network_request" ||
    name === "browser_network_requests" ||
    name === "browser_console_messages"
  )
}

/**
 * Refuse a file name that does not resolve inside the browser output directory. The MCP resolves a relative name
 * against the workspace root, so a result file written there could not be redacted, baselined or deleted here.
 */
export function insideOutput(filename: string, directory = outputDirectory()): string {
  const resolved = path.resolve(filename)
  if (resolved !== directory && !resolved.startsWith(directory + path.sep)) {
    throw new Error("The file name must stay inside the browser output directory.")
  }
  return resolved
}

/**
 * The page a call leaves current. A page created during the call wins (a new tab, `window.open`); then the model's
 * own tab choice; otherwise the page the session already had. Tool text is never an input.
 */
export function tabChoice(input: {
  known: Page | undefined
  before: readonly Page[]
  after: readonly Page[]
  name: string
  args: Record<string, unknown>
}): Page | undefined {
  const after = input.after
  if (!after.length) return undefined
  const added = after.filter((page) => !input.before.includes(page))
  if (added.length) return added[added.length - 1]
  if (input.name === "browser_tabs" && input.args.action === "select" && typeof input.args.index === "number") {
    return after[input.args.index] ?? input.known ?? after[after.length - 1]
  }
  if (input.name === "browser_tabs" && input.args.action === "close") {
    return input.known && after.includes(input.known) ? input.known : after[after.length - 1]
  }
  return input.known && after.includes(input.known) ? input.known : after[after.length - 1]
}

/** The file link of a screenshot the backend deleted; the masked image replaces it. */
function withoutScreenshotLink(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^- \[Screenshot[^\]]*\]\(.+\)$/.test(line.trim()))
    .join("\n")
}

class PlaywrightBackend implements BrowserBackend {
  readonly id = "playwright" as const
  readonly contractSha = BrowserContract.sha256
  private readonly off: Array<() => void> = []
  private disposed = false
  /**
   * The page each session acted on. It is a page object, not a URL taken from tool text: a page can name any URL in
   * its own output, but it cannot choose which page the next call inspects. A tab is added by a call that creates one
   * (`browser_tabs new`, a `window.open`) or selected by the model's own `index`, never by page content.
   */
  private readonly pages = new Map<string, Page>()

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

  /** The page this session acts on, or the newest one when the session has none (a first call, or it was closed). */
  private current(session: string): Page | undefined {
    const pages = this.conn.context.pages()
    if (!pages.length) return undefined
    const known = this.pages.get(session)
    if (known && pages.includes(known)) return known
    return pages[pages.length - 1]
  }

  /** Follow the call's own intent: a tab it created, or the model's own tab choice. */
  private track(session: string, name: string, args: Record<string, unknown>, before: readonly Page[]) {
    const next = tabChoice({
      known: this.pages.get(session),
      before,
      after: this.conn.context.pages(),
      name,
      args,
    })
    if (next) this.pages.set(session, next)
    else this.pages.delete(session)
  }

  /** The frame a `[ref=…]` snapshot ref lives in, resolved through Playwright's aria-ref engine. */
  private async frameOf(page: Page, ref: string): Promise<Frame | undefined> {
    const handle = await page
      .locator(`aria-ref=${ref}`)
      .elementHandle({ timeout: 2_000 })
      .catch(() => null)
    if (!handle) return undefined
    // An iframe ref points at the frame element in its parent; the grant belongs to the document it contains, so
    // prefer the child frame when there is one.
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

  /**
   * Refs of every iframe node in a snapshot text, with the origin of the frame they contain. A ref that does not
   * resolve is absent: the caller withholds it.
   */
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
      const origin = frame ? frameOrigin(frame) : undefined
      if (origin) origins.set(node.ref, origin)
    }
    return origins
  }

  private async filter(page: Page, name: string, text: string, authorized: readonly string[]) {
    const withheld = withheldFrames(page, authorized)
    if (!withheld.length) return { text, refused: false }
    const origins = new Set(withheld.map((frame) => frameOrigin(frame)).filter((origin): origin is string => !!origin))
    const resolved = text.includes("### Snapshot") ? await this.frameOrigins(page, text) : undefined
    return Frames.scope({
      tool: name,
      text,
      withholding: true,
      withheld: origins,
      origins: resolved,
      granted: (origin) => authorized.includes(`read:${origin}`),
    })
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

  /** Mask every withheld frame's box in-place. `false` means the image must not leave the backend. */
  private async maskFrames(page: Page, images: ContentBlock[], frames: Frame[], fullPage: boolean) {
    const boxes = await this.maskBoxes(page, frames, fullPage)
    for (const image of images) {
      if (image.type !== "image") continue
      if (image.mimeType !== "image/png") return false
      const masked = Png.mask(Png.decode(Buffer.from(image.data, "base64")), boxes)
      image.data = Png.encode(masked).toString("base64")
      image.mimeType = "image/png"
    }
    return images.some((image) => image.type === "image")
  }

  private async outputFiles() {
    return new Set(await fs.readdir(outputDirectory()).catch(() => []))
  }

  private async removeNewFiles(before: ReadonlySet<string>) {
    const after = await this.outputFiles()
    for (const name of after) {
      if (before.has(name)) continue
      await fs.unlink(path.join(outputDirectory(), name)).catch(() => {})
    }
  }

  async plan(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<Item[]> {
    const page = this.current(ctx.session ?? "")
    const elements: BrowserItems.Element[] = []
    if (page) {
      for (const ref of BrowserItems.refs(args)) {
        const frame = await this.frameOf(page, ref)
        // A frame without an http(s) origin of its own is keyed by its site, so an opaque tab still asks.
        const origin = frame && (frameOrigin(frame) ?? BrowserPermission.site(frame.url()))
        if (!frame || !origin) continue
        elements.push({ ref, origin, frame: frame !== page.mainFrame() })
      }
    }
    // The page key is the site, so an `about:blank` or `data:` tab reaches a decision instead of `[]`.
    const key = page && (BrowserPermission.origin(page.url()) ?? BrowserPermission.site(page.url()))
    return BrowserItems.plan({
      tool: name,
      args,
      page: key,
      elements,
      authorized: ctx.authorized ?? [],
    })
  }

  async callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    // Running code in the CLI process is not a browser action we can bound, so this backend refuses it.
    if (name === "browser_run_code_unsafe") throw new UnsupportedError()
    const authorized = ctx.authorized ?? []
    const session = ctx.session ?? ""
    const pagesBefore = this.conn.context.pages()
    let page = this.current(session)

    // Every URL a call would open is checked before the browser sees it: a scheme without an http(s) origin has no
    // grant to ask for, so it must not reach a page - or a new tab - at all.
    for (const target of navigationTargets(name, args)) {
      const refusal = navigationRefusal(target)
      if (refusal) throw new Error(refusal)
    }

    // Sensitive steps are classified on the live element, then approved one step at a time. A document without an
    // origin (`about:blank`, a `data:` page) still needs its step approved, keyed by the site it lives in.
    if (page) {
      const reasons = await this.sensitive(name, args, page)
      const site = BrowserPermission.site(page.url())
      if (reasons.length && !site) {
        throw new Error("A sensitive step was refused: the page has no URL to bind the approval to.")
      }
      if (reasons.length && site && !stepApproved(ctx.sensitive ?? [], name, args, site)) {
        throw new NeedsPermissionError(
          [{ class: "sensitive", origin: site, reason: reasons.join("; ") }],
          approveStep(name, args, site),
        )
      }
    }

    // A screenshot may not leave the backend with a withheld frame visible in pixels or file. Every screenshot is
    // taken inline as PNG in CSS pixels: the backend masks it and returns the image, so the MCP never writes pixels
    // to a file the backend cannot inspect, and a frame that starts loading during the call cannot leave one behind.
    const withheldBefore = page ? withheldFrames(page, authorized) : []
    const shot = name === "browser_take_screenshot"
    let callArgs = args
    if (shot) {
      if (args.target !== undefined && withheldBefore.length) {
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page is withheld." }],
          isError: true,
        }
      }
      callArgs = { ...args, type: "png", scale: "css" }
      delete callArgs.filename
    }
    // A file name the model supplies is resolved by the MCP against the workspace root, outside the directory this
    // backend owns: only a path that stays inside the output directory is accepted.
    if (typeof args.filename === "string" && args.filename.trim() !== "") insideOutput(args.filename)
    // The withheld set is read again after the call, so the baseline cannot depend on a frame being withheld now.
    const before = outputBaseline(name) ? await this.outputFiles() : undefined

    const downloads: string[] = []
    const onDownload = (download: Download) => {
      const site = page && BrowserPermission.site(page.url())
      if (site && stepApproved(ctx.sensitive ?? [], name, args, site)) return
      downloads.push(download.suggestedFilename())
      void download.cancel().catch(() => undefined)
    }
    let result: CallToolResult
    this.conn.context.on("download", onDownload)
    try {
      result = await this.conn.client.callTool({ name, arguments: callArgs }, { timeout: TIMEOUT, signal: ctx.signal })
      // A download starts alongside the action that triggers it; give the event a moment to surface.
      if (page && ["browser_click", "browser_drop", "browser_press_key", "browser_navigate"].includes(name)) {
        await page.waitForTimeout(150).catch(() => undefined)
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
    this.track(session, name, args, pagesBefore)
    page = this.current(session)

    if (downloads.length) {
      const site = page && BrowserPermission.site(page.url())
      if (site) {
        throw new NeedsPermissionError(
          [{ class: "sensitive", origin: site, reason: `download: ${downloads.join(", ")}` }],
          approveStep(name, args, site),
        )
      }
      throw new Error("A download was refused: the page has no URL to bind the approval to.")
    }

    // A navigation can land on another origin through a redirect; the real origin decides. A landing page without an
    // http(s) origin is refused the same way as such a target.
    if (page && (name === "browser_navigate" || name === "browser_navigate_back" || name === "browser_tabs")) {
      const refusal = navigationRefusal(page.url())
      if (refusal) throw new Error(refusal)
      const origin = BrowserPermission.origin(page.url())
      if (origin && !authorized.includes(`read:${origin}`) && !authorized.includes(`navigate:${origin}`)) {
        throw new NeedsPermissionError([{ class: "navigate", origin }])
      }
    }

    const withheld = page ? withheldFrames(page, authorized) : []
    const scoped = page ? await this.filter(page, name, text, authorized) : { text, refused: false }
    const viewed = scoped.text
    const images = content.filter((block): block is Extract<ContentBlock, { type: "image" }> => block.type === "image")
    const origin = page && BrowserPermission.origin(page.url())
    const withheldOrigins = withheld
      .map((frame) => frameOrigin(frame))
      .filter((value): value is string => value !== undefined)

    if (scoped.refused) {
      // A file the refused call wrote must not outlive the call either.
      if (before) await this.removeNewFiles(before)
      return {
        content: [{ type: "text", text: viewed }],
        isError: true,
        meta: {
          ...(origin ? { origin } : {}),
          ...(withheldOrigins.length ? { withheldFrames: [...new Set(withheldOrigins)] } : {}),
        },
      }
    }

    if (withheld.length && shot) {
      // Whatever the MCP saved was written before masking: it must not outlive the call, and its path is not an
      // acceptable answer either, because the model would open the unmasked pixels.
      if (before) await this.removeNewFiles(before)
      const masked =
        images.length > 0 && page && args.target === undefined
          ? await this.maskFrames(page, images, withheld, args.fullPage === true).catch(() => false)
          : false
      if (!masked) {
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page is withheld." }],
          isError: true,
          meta: {
            ...(origin ? { origin } : {}),
            ...(withheldOrigins.length ? { withheldFrames: [...new Set(withheldOrigins)] } : {}),
          },
        }
      }
      // The file link points at the deleted file; the masked image is the answer.
      return {
        content: [{ type: "text", text: withoutScreenshotLink(viewed) }, ...images],
        isError: result.isError === true,
        meta: {
          ...(origin ? { origin } : {}),
          ...(withheldOrigins.length ? { withheldFrames: [...new Set(withheldOrigins)] } : {}),
        },
      }
    }

    const meta: CallMeta = {
      ...(page ? { url: page.url() } : {}),
      ...(origin ? { origin } : {}),
      ...(withheldOrigins.length ? { withheldFrames: [...new Set(withheldOrigins)] } : {}),
    }
    return {
      content: [{ type: "text", text: viewed }, ...images],
      isError: result.isError === true,
      meta,
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
    // An entry may still be launching: wait for it, so the process it starts is closed too.
    await Promise.all(
      values.map(async (entry) => {
        const backend = await entry.promise.catch(() => undefined)
        await backend?.dispose()
      }),
    )
  }
}

export function key(settings: Settings) {
  return JSON.stringify({ backend: settings.backend, target: settings.target, headless: settings.headless })
}

/** The process-wide browser pool of the bundled Playwright backend. */
export const playwright = new Backends((value, evict) => PlaywrightBackend.create(JSON.parse(value) as Settings, evict))
