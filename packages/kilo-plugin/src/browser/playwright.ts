import { createHash, randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
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
const STEPS = new Map<string, { hash: string; expires: number; origin: string; session: string }>()
const STEP_TTL = 60_000
const STEP_LIMIT = 200

function stepHash(session: string, tool: string, args: Record<string, unknown>, origin: string) {
  return createHash("sha256").update(JSON.stringify({ session, tool, args, origin })).digest("hex")
}

function approveStep(session: string, tool: string, args: Record<string, unknown>, origin: string) {
  const now = Date.now()
  for (const [token, step] of STEPS) if (step.expires < now) STEPS.delete(token)
  while (STEPS.size >= STEP_LIMIT) {
    const oldest = STEPS.keys().next().value
    if (oldest === undefined) break
    STEPS.delete(oldest)
  }
  const token = randomUUID()
  STEPS.set(token, { hash: stepHash(session, tool, args, origin), expires: now + STEP_TTL, origin, session })
  return token
}

function stepApproved(
  session: string,
  tokens: readonly string[],
  tool: string,
  args: Record<string, unknown>,
  origin: string,
) {
  const hash = stepHash(session, tool, args, origin)
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

/**
 * Approve a step without handing its token to anyone: the next identical call finds the approval by its own tool,
 * arguments and site. Used for a download the user approved after the action had already run.
 */
export function persistStep(session: string, tool: string, args: Record<string, unknown>, origin: string) {
  approveStep(session, tool, args, origin)
}

/** True when a step for exactly this tool, arguments and site was approved recently, whatever token came with it. */
export function stepPersisted(session: string, tool: string, args: Record<string, unknown>, origin: string) {
  const hash = stepHash(session, tool, args, origin)
  for (const step of STEPS.values()) {
    if (step.expires < Date.now()) continue
    if (step.hash === hash) return true
  }
  return false
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
  const resolved = await snapshotFile(file, root)
  if (!resolved) return undefined
  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile() || stat.size > INLINE_LIMIT) return undefined
  return fs.readFile(resolved, "utf8").catch(() => undefined)
}

/**
 * The real path of a snapshot link, or undefined. The MCP prints the path relative to the process working directory
 * (the CLI's project directory), so that is the base; the output directory is the fallback for a link that already
 * points there. Either way the file must resolve inside the output directory the backend owns.
 */
export async function snapshotFile(file: string, root: string, cwd = process.cwd()): Promise<string | undefined> {
  // The boundary is canonicalized too: a temp directory may be spelled with a short name or another drive case.
  const boundary = await fs.realpath(root).catch(() => root)
  for (const base of [cwd, root]) {
    const resolved = await fs.realpath(path.resolve(base, file)).catch(() => undefined)
    if (!resolved) continue
    if (!contained(resolved, boundary)) continue
    return resolved
  }
  return undefined
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
  // Screenshots accumulate; keep the directory bounded whenever a browser starts.
  await retainScreenshots(out)
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

/** A snapshot ref, the only target form the aria-ref engine resolves. */
const TARGET_REF = /^(f\d+)?e\d+$/

/** Page probe: any frame holds a field the sensitive gate protects. */
async function sensitiveFields(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input,select,textarea"))
        return inputs.some((el) => {
          const type = (el.getAttribute("type") ?? "").toLowerCase()
          const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase()
          const name = (el.getAttribute("name") ?? "").toLowerCase()
          return (
            type === "password" ||
            autocomplete.includes("one-time-code") ||
            autocomplete.startsWith("cc-") ||
            name === "cardnumber"
          )
        })
      })
      .catch(() => false)
    if (found === true) return true
  }
  return false
}

/** Page probe: the focused control is a sensitive field or sits in a form that holds card fields. */
async function sensitiveFocus(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(() => {
        const el = document.activeElement
        if (!el || !(el instanceof Element)) return false
        const check = (node: Element) => {
          const type = (node.getAttribute("type") ?? "").toLowerCase()
          const autocomplete = (node.getAttribute("autocomplete") ?? "").toLowerCase()
          const name = (node.getAttribute("name") ?? "").toLowerCase()
          return (
            type === "password" ||
            autocomplete.includes("one-time-code") ||
            autocomplete.startsWith("cc-") ||
            name === "cardnumber"
          )
        }
        if (check(el)) return true
        const form = el.closest("form")
        return !!form && Array.from(form.querySelectorAll("input")).some((input) => check(input))
      })
      .catch(() => false)
    if (found === true) return true
  }
  return false
}

/**
 * Bound the screenshot files in the output directory: the backend's own `page-*` names and the MCP's. Anything older
 * than a day goes, and the newest 200 are kept. A name the user chose is never touched.
 */
export async function retainScreenshots(directory = outputDirectory(), now = Date.now(), limit = 200) {
  const names = (await fs.readdir(directory).catch(() => [] as string[])).filter((name) => /^page-.*\.png$/.test(name))
  const files: { path: string; mtime: number }[] = []
  for (const name of names) {
    const file = path.join(directory, name)
    const stat = await fs.stat(file).catch(() => undefined)
    if (stat?.isFile()) files.push({ path: file, mtime: stat.mtimeMs })
  }
  const fresh = files.filter((file) => file.mtime >= now - 24 * 60 * 60 * 1000)
  const keep = new Set(
    fresh
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, limit)
      .map((file) => file.path),
  )
  for (const file of files) {
    if (keep.has(file.path)) continue
    await fs.unlink(file.path).catch(() => undefined)
  }
}

/** The MCP's screenshot file name, `page-<timestamp>.png`. */
function autoShotName() {
  return `page-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}.png`
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
 * The output path a screenshot asked for, or undefined. A name outside the browser output directory is refused; the
 * file is written from the inline image the backend masked, never by the MCP.
 */
export function screenshotPath(
  name: string,
  args: Record<string, unknown>,
  directory = outputDirectory(),
): string | undefined {
  if (name !== "browser_take_screenshot") return undefined
  const filename = typeof args.filename === "string" ? args.filename.trim() : ""
  return filename === "" ? undefined : insideOutput(filename, directory)
}

/**
 * Every tool whose result the MCP can write to a file, with the link title it uses. `browser_run_code_unsafe` takes
 * one too, but this backend refuses that tool before any file exists; `browser_take_screenshot` is written from the
 * masked image by `screenshotPath`. A contract bump that adds another file-writing tool must extend this map.
 */
export const FILE_TITLES: Record<string, string> = {
  browser_snapshot: "Snapshot",
  browser_console_messages: "Console",
  browser_network_requests: "Network",
  browser_network_request: "Request",
  browser_evaluate: "Result",
}

/**
 * The file a call asks for, and the arguments to run it with. The MCP's copy of that file is written before any
 * filtering and would keep a withheld frame's content, so the backend writes the file itself from the filtered text:
 * the name is removed from the arguments the MCP sees.
 */
export function outputFile(
  name: string,
  args: Record<string, unknown>,
  directory = outputDirectory(),
): { tool: string; path: string; link: string; args: Record<string, unknown> } | undefined {
  const title = FILE_TITLES[name]
  if (!title) return undefined
  const filename = typeof args.filename === "string" ? args.filename.trim() : ""
  if (filename === "") return undefined
  const target = insideOutput(filename, directory)
  const { filename: _omitted, ...rest } = args
  return { tool: name, path: target, link: `- [${title}](${target})`, args: rest }
}

/** The body the MCP writes for a snapshot: the YAML block, without the section heading or the fences. */
export function snapshotBody(text: string): string {
  const block = /```yaml\n([\s\S]*?)\n```/.exec(text)
  return block ? `${block[1]}\n` : text
}

/** Write a result file from the filtered text, so a withheld frame never reaches the copy on disk. */
async function saveOutput(file: { tool: string; path: string }, text: string) {
  const body = file.tool === "browser_snapshot" ? snapshotBody(text) : text
  await writeConfined(file.path, body)
}

/**
 * Resolve a file name inside the browser output directory, refusing one that escapes it. A relative name resolves
 * against that directory, never the process working directory.
 */
export function insideOutput(filename: string, directory = outputDirectory()): string {
  // A relative name belongs to the output directory: the model never means the process working directory.
  const base = canonical(path.resolve(directory))
  const resolved = path.resolve(base, filename)
  // The parent may exist under a different spelling (8.3 short name, drive-letter case), so canonicalize it too.
  // `canonical` resolves the final component too, so a symlink at the target name is checked by its destination.
  const target = canonical(path.join(canonical(path.dirname(resolved)), path.basename(resolved)))
  if (!contained(target, base)) throw new Error("The file name must stay inside the browser output directory.")
  return target
}

/** The real path when the file exists, so containment compares what the filesystem reports. */
function canonical(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}

/**
 * True when `target` is `root` or below it, on either platform's spelling. `startsWith(root + "/")` is wrong on
 * win32 (backslashes, drive-letter case, 8.3 names) and would refuse or admit the wrong paths; `path.relative` is
 * the only correct containment test, and win32 compares case-insensitively.
 */
export function contained(target: string, root: string, flavour: typeof path = path): boolean {
  const fold = (value: string) => (flavour === path.win32 ? value.toLowerCase() : value)
  const relative = flavour.relative(fold(root), fold(target))
  if (relative === "") return true
  if (flavour.isAbsolute(relative)) return false
  // The first path segment decides: `..` is an escape, `..foo` is an ordinary name.
  const [first] = relative.split(flavour.sep)
  return first !== ".."
}

/** Write a file this backend owns, refusing a symbolic link at the target name and creating its parent. */
async function writeConfined(file: string, body: string | Uint8Array) {
  const existing = await fs.lstat(file).catch(() => undefined)
  if (existing?.isSymbolicLink()) throw new Error("The file name must not be a symbolic link.")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

/**
 * Drop every session whose page the context no longer has. A session with a live page keeps it, however many sessions
 * have come and gone; the plugin releases a session's entry when the session is deleted.
 */
export function prunePages(pages: Map<string, Page>, live: readonly Page[]) {
  for (const [session, page] of pages) {
    if (!live.includes(page)) pages.delete(session)
  }
}

/** Hard cap, last resort only: sessions are released when they end, long before this. */
const PAGE_LIMIT = 1024

/** Remember a session's page, least recently used first out past the cap. */
export function rememberPage(pages: Map<string, Page>, session: string, page: Page, limit = PAGE_LIMIT) {
  pages.delete(session)
  pages.set(session, page)
  while (pages.size > limit) {
    const oldest = pages.keys().next()
    if (oldest.done) break
    pages.delete(oldest.value)
  }
}

/**
 * The origin a call meant to act on: the URL it asked to open, or the page it started on. A navigation's plan is the
 * target, so a redirect that lands elsewhere is detectable.
 */
export function plannedOrigin(tool: string, args: Record<string, unknown>, page?: string): string | undefined {
  const target = BrowserItems.targets(tool, args)[0]
  if (target === undefined) return page
  return BrowserPermission.origin(target) ?? BrowserPermission.site(target)
}

/**
 * What an action's result needs after the action ran. Any action can move the tab to another origin (a click, a key,
 * a script, a redirect); when that origin was never granted, the result belongs to a page this session did not ask
 * about. The caller withholds the content and asks for read - it never re-runs the action, so side effects happen
 * once. Read tools and unchanged origins need nothing.
 */
export function landingNeed(input: {
  tool: string
  planned?: string
  landed?: string
  authorized: readonly string[]
}): Item | undefined {
  const landed = input.landed
  if (!landed || landed === input.planned) return undefined
  if (BrowserPermission.classOf(input.tool) === "read") return undefined
  if (input.authorized.includes(`read:${landed}`)) return undefined
  // A navigation the session was allowed to make may report where it landed.
  if (BrowserPermission.classOf(input.tool) === "navigate" && input.authorized.includes(`navigate:${landed}`)) {
    return undefined
  }
  return { class: "read", origin: landed }
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
    // Only a session whose page is gone loses its entry: a live session keeps its page whatever the session count.
    prunePages(this.pages, pages)
    const known = this.pages.get(session)
    if (!pages.length) return undefined
    if (known) return known
    return pages[pages.length - 1]
  }

  /** Remember a session's page, least recently used first out past the hard cap. */
  private remember(session: string, page: Page) {
    rememberPage(this.pages, session, page)
  }

  /** Release a session's page when the session ends. */
  forget(session: string) {
    this.pages.delete(session)
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
    if (next) this.remember(session, next)
    else this.pages.delete(session)
  }

  /** The frame a `[ref=…]` snapshot ref lives in, resolved through Playwright's aria-ref engine. */
  /**
   * The element a `target` names, resolved the way the MCP resolves it: a snapshot ref (`e12`, `f2e7`) through the
   * aria-ref engine, anything else as a page selector, where the MCP takes the first match. The gate needs exactly
   * one element, so an ambiguous or missing target stays unresolved and is treated as sensitive.
   */
  private async elementOf(page: Page, target: string) {
    const locator = TARGET_REF.test(target) ? page.locator(`aria-ref=${target}`) : page.locator(target)
    const count = await locator.count().catch(() => 0)
    if (count !== 1) return { state: "unresolved" as const }
    const handle = await locator.elementHandle({ timeout: 2_000 }).catch(() => null)
    if (!handle) return { state: "unresolved" as const }
    // An iframe target points at the frame element in its parent; the grant belongs to the document it contains.
    const child = await handle.contentFrame().catch(() => null)
    const frame = child ?? (await handle.ownerFrame())
    return { state: "resolved" as const, handle, frame: frame ?? undefined }
  }

  /** The frame a `target` lives in: the child document for an iframe target, otherwise the element's own frame. */
  private async frameOf(page: Page, ref: string): Promise<Frame | undefined> {
    const element = await this.elementOf(page, ref)
    if (element.state !== "resolved") return undefined
    element.handle.dispose()
    return element.frame
  }

  private async inspect(page: Page, ref: string, kind: "fill" | "click"): Promise<string> {
    const element = await this.elementOf(page, ref)
    // A target the backend cannot resolve to one element is refused, not skipped: it may be the field the gate wants.
    if (element.state !== "resolved") return "unresolved target"
    const reason = await element.handle.evaluate(inspectElement, kind).catch(() => "")
    element.handle.dispose()
    return typeof reason === "string" && reason !== "" ? reason : ""
  }

  private async sensitive(session: string, name: string, args: Record<string, unknown>, page: Page): Promise<string[]> {
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
    // A script and a key press can reach what the element-level check inspects, so they are classified on the page.
    if (name === "browser_evaluate" || name === "browser_run_code_unsafe") {
      if (await sensitiveFields(page)) reasons.push("a page script can reach a sensitive field")
    }
    if (name === "browser_press_key") {
      if (await sensitiveFocus(page)) reasons.push("the focused control is a sensitive field")
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
    // Lines are attributed to a granted origin: an opaque frame, a blob: script URL or a request from a frame we
    // cannot name all fall out, because none of them can be attributed to a page we may read.
    const allowed = new Set(
      authorized.filter((entry) => entry.startsWith("read:")).map((entry) => entry.slice("read:".length)),
    )
    const resolved = text.includes("### Snapshot") ? await this.frameOrigins(page, text) : undefined
    return Frames.scope({
      tool: name,
      text,
      withholding: true,
      withheld: origins,
      allowed,
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

  /** Delete the files this call wrote, and nothing else: the output directory is shared by every session. */
  private async removeWritten(files: readonly string[]) {
    for (const file of files) await fs.unlink(file).catch(() => {})
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
      const reasons = await this.sensitive(session, name, args, page)
      const site = BrowserPermission.site(page.url())
      if (reasons.length && !site) {
        throw new Error("A sensitive step was refused: the page has no URL to bind the approval to.")
      }
      if (reasons.length && site && !stepApproved(session, ctx.sensitive ?? [], name, args, site)) {
        throw new NeedsPermissionError(
          [{ class: "sensitive", origin: site, reason: reasons.join("; ") }],
          approveStep(session, name, args, site),
        )
      }
    }

    // A screenshot may not leave the backend with a withheld frame visible in pixels or file. Every screenshot is
    // taken inline as PNG in CSS pixels: the backend masks it and returns the image, so the MCP never writes pixels
    // to a file the backend cannot inspect, and a frame that starts loading during the call cannot leave one behind.
    const withheldBefore = page ? withheldFrames(page, authorized) : []
    const shot = name === "browser_take_screenshot"
    // Every file this call writes is tracked by path: another session's file in the shared directory must survive.
    const written: string[] = []
    let callArgs = args
    // The MCP writes into a file this backend names, so the capture path is ours: never derived from tool output. The
    // bytes are read back and the capture removed once the final PNG is persisted.
    const capture = shot ? path.join(outputDirectory(), `.mcp-${randomUUID()}.png`) : undefined
    if (shot) {
      if (args.target !== undefined && withheldBefore.length) {
        return {
          content: [{ type: "text", text: "The screenshot is unavailable: part of the page is withheld." }],
          isError: true,
        }
      }
      callArgs = { ...args, type: "png", scale: "css", filename: capture }
      if (capture) written.push(capture)
    }
    // A file name the model supplies is resolved by the MCP against the workspace root, outside the directory this
    // backend owns: only a path that stays inside the output directory is accepted. A screenshot is written from the
    // image the backend holds, so masking is applied to the file as well.
    // The caller's name when given, otherwise a name in the MCP's own style: an allowed screenshot always leaves a
    // file that the result can link to.
    const save = shot ? (screenshotPath(name, args) ?? path.join(outputDirectory(), autoShotName())) : undefined
    // The MCP never writes a result file: it would hold the withheld frames' content unfiltered. The backend writes
    // the file from the filtered text instead, so the name is removed from the arguments the MCP sees.
    const file = shot ? undefined : outputFile(name, args)
    if (file) callArgs = file.args
    // What the call meant to act on, so a landing elsewhere is visible after it ran.
    const planned = plannedOrigin(name, args, page && BrowserPermission.origin(page.url()))
    const downloads: string[] = []
    const kept: string[] = []
    const onDownload = (download: Download) => {
      const site = page && BrowserPermission.site(page.url())
      // `allow_sensitive` keeps the file on the first call; a persisted approval does it on the next identical one.
      const approved =
        site !== undefined &&
        (ctx.allowSensitive === true ||
          stepApproved(session, ctx.sensitive ?? [], name, args, site) ||
          stepPersisted(session, name, args, site))
      if (approved) {
        kept.push(download.suggestedFilename())
        return
      }
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
    if (capture) {
      // The MCP saved the pixels to the path this call chose; read them and drop the file again.
      const bytes = await fs.readFile(capture).catch(() => undefined)
      await fs.unlink(capture).catch(() => undefined)
      if (bytes) content.push({ type: "image", data: bytes.toString("base64"), mimeType: "image/png" })
    }
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

    // A navigation tool may not land on a scheme without an http(s) origin; the same refusal as its target.
    if (page && (name === "browser_navigate" || name === "browser_navigate_back" || name === "browser_tabs")) {
      const refusal = navigationRefusal(page.url())
      if (refusal) throw new Error(refusal)
    }

    // Every action, not just the navigation tools, can leave the tab on an origin this session never asked about. The
    // action already ran, so its content is withheld and read is requested: the call is never retried.
    const need = page && landingNeed({ tool: name, planned, landed: BrowserPermission.origin(page.url()), authorized })
    if (need && page) {
      // Only the URL: a title is content of an origin this session was never granted.
      return {
        content: [
          {
            type: "text",
            text: [
              `- Page URL: ${page.url()}`,
              "",
              `The page moved to ${need.origin}; its content is withheld until read is granted.`,
            ].join("\n"),
          },
        ],
        isError: false,
        meta: { url: page.url(), needs: [need] },
      }
    }

    const withheld = page ? withheldFrames(page, authorized) : []
    const scoped = page ? await this.filter(page, name, text, authorized) : { text, refused: false }
    let viewed = scoped.text
    const images = content.filter((block): block is Extract<ContentBlock, { type: "image" }> => block.type === "image")
    const origin = page && BrowserPermission.origin(page.url())
    const withheldOrigins = withheld
      .map((frame) => frameOrigin(frame))
      .filter((value): value is string => value !== undefined)

    if (scoped.refused) {
      // A file the refused call wrote must not outlive the call either.
      await this.removeWritten(written)
      return {
        content: [{ type: "text", text: viewed }],
        isError: true,
        meta: {
          ...(origin ? { origin } : {}),
          ...(withheldOrigins.length ? { withheldFrames: [...new Set(withheldOrigins)] } : {}),
        },
      }
    }

    if (kept.length) viewed = `${viewed}\n\nA download was kept: ${kept.join(", ")}.`
    if (downloads.length && page) {
      // The click already ran. A download cannot be resumed after it was stopped, so the action is never repeated:
      // the result says the download needs approval and the user retries the step after approving.
      const site = BrowserPermission.site(page.url())
      if (!site) throw new Error("A download was refused: the page has no URL to bind the approval to.")
      return {
        content: [
          {
            type: "text",
            text: `${viewed}\n\nA download started (${downloads.join(", ")}) and was stopped: it needs the user's permission. The action already ran once and is never repeated; once approved, repeat the same step to receive the file.`,
          },
        ],
        isError: false,
        meta: {
          ...(origin ? { origin } : {}),
          needs: [{ class: "sensitive", origin: site, reason: `download: ${downloads.join(", ")}` }],
        },
      }
    }

    if (file && !scoped.refused) {
      await saveOutput(file, viewed)
      written.push(file.path)
      viewed = `${viewed}\n\n${file.link}`
    }

    if (withheld.length && shot) {
      // Whatever the MCP saved was written before masking: it must not outlive the call, and its path is not an
      // acceptable answer either, because the model would open the unmasked pixels. Only this call's own file goes.
      await this.removeWritten(written)
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
      // The masked image is persisted as the answer, and the result links to that file.
      if (save && images[0]) {
        await writeConfined(save, Buffer.from(images[0].data, "base64"))
        written.push(save)
      }
      const link = save ? `- [Screenshot](${save})` : undefined
      return {
        content: [{ type: "text", text: [withoutScreenshotLink(viewed), link].filter(Boolean).join("\n") }, ...images],
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
    if (save && images[0]) {
      await writeConfined(save, Buffer.from(images[0].data, "base64"))
      written.push(save)
      viewed = `${viewed}\n- [Screenshot](${save})`
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
    this.pages.clear()
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

  /** Release a deleted session's page on every live backend. A missing backend is not launched for it. */
  forgetSession(session: string) {
    for (const entry of this.entries.values()) entry.backend?.forget?.(session)
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
