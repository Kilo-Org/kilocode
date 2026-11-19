#!/usr/bin/env bun
// Real end-to-end check of the Kilo browser bridge: the built Chrome MV3 extension loaded into Chromium, paired over
// loopback with the real CLI (`kilo2 run`, `browser.backend: "extension"`), driven by a scripted OpenAI-compatible
// model. Not a `bun test` file: it needs a display (run it under xvfb), a built CLI binary and the built extension.
//
//   bun test/browser/extension-e2e.ts <kilo2> <scenario>
//
//   E2E_EXTENSION_DIR   the built unpacked extension (default: ../../../cloud/apps/extension/.output/chrome-mv3)
//   E2E_CHROMIUM        the Chromium executable (default: playwright-core's own build)
//   E2E_HOME            the run's home (default: a fresh mkdtemp); the harness creates run-<n> under it
//   E2E_DOWNLOADS       Chrome's default download directory (default: $HOME/Downloads)
//
// Scenarios: navigate-snapshot, permission, frames, sensitive, group, stop, unpaired, download.
//
// Each scenario prints one JSON report and exits non-zero when an expectation fails. Every CLI run gets a fresh
// E2E_HOME, a fresh hub and a fresh loopback pairing; two CLI runs in one scenario never overlap.
//
// The product path this exercises, in order: the extension's "Allow local agents" switch (its settings page, with the
// optional nativeMessaging prompt granted the way an accepted prompt would), `kilo2 browser hub --loopback`, the
// hub's `pairing.url` RPC over the per-user CLI socket, the pairing page opened in the Chromium context (the
// extension redeems the token and dials the hub), then `kilo2 run` with a scripted model.
import * as Png from "@kilocode/kilo-plugin/browser/png"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const binaryInput = process.argv[2]
const scenario = process.argv[3] ?? "navigate-snapshot"
if (!binaryInput) throw new Error("usage: bun test/browser/extension-e2e.ts <kilo2> <scenario>")
// Spawned runs use a fresh HOME as their cwd, so the binary path must not depend on the harness's cwd.
const binary = path.resolve(binaryInput)

// playwright-core belongs to the plugin workspace, not this package, so the specifier is resolved from there at
// runtime: a static import would depend on hoisting that the workspace does not promise.
const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright = (await import(Bun.resolveSync("playwright-core", pluginDirectory))) as unknown as Playwright
const chromium = playwright.chromium

const extensionDirectory =
  process.env.E2E_EXTENSION_DIR ?? path.resolve(import.meta.dirname, "../../../../cloud/apps/extension/.output/chrome-mv3")
const executablePath = process.env.E2E_CHROMIUM ?? chromium.executablePath()

const MARKER = "IFRAME-MARKER"
const PUBLIC_MARKER = "PUBLIC-ORIGIN"
const PASSWORD_VALUE = "hunter2"

/**
 * The extension APIs this harness evaluates inside the service worker. The CLI package has no extension typings, so
 * this is the narrow global the evaluated callbacks use; each result is validated before the harness reads it.
 */
declare const chrome: {
  storage: {
    local: {
      get(key: string): Promise<unknown>
      set(items: Record<string, unknown>, callback: () => void): void
    }
  }
  tabGroups: {
    get(groupId: number): Promise<unknown>
    query(query: Record<string, unknown>): Promise<unknown>
  }
  tabs: { query(query: Record<string, unknown>): Promise<unknown> }
}

// ---------------------------------------------------------------------------------------------
// The slice of Playwright this harness drives. Typed here so the test code stays checked without pulling Playwright
// declarations into the CLI package.
// ---------------------------------------------------------------------------------------------

type Locator = {
  click(): Promise<void>
  getAttribute(name: string): Promise<string | null>
  waitFor(options?: { timeout?: number }): Promise<void>
}

type CdpSession = {
  on(event: string, listener: (payload: unknown) => void): void
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

type Worker = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
  url(): string
}

type Page = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  getByRole(role: string, options?: { name?: string }): Locator
  goto(url: string): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): void
  reload(): Promise<unknown>
  setDefaultTimeout(timeout: number): void
  url(): string
}

type Route = { fulfill(options: { json: unknown; status: number }): Promise<void> }

type Context = {
  addInitScript(script: { content: string }): Promise<void>
  browser(): { newBrowserCDPSession(): Promise<CdpSession> } | null
  close(): Promise<void>
  newCDPSession(page: Page): Promise<CdpSession>
  newPage(): Promise<Page>
  on(event: string, listener: (payload: unknown) => void): void
  pages(): Page[]
  route(url: string | ((url: URL) => boolean), handler: (route: Route) => Promise<void> | void): Promise<void>
  serviceWorkers(): Worker[]
  setDefaultTimeout(timeout: number): void
  waitForEvent(event: string): Promise<Worker>
}

type Playwright = {
  chromium: {
    executablePath(): string
    launchPersistentContext(directory: string, options: Record<string, unknown>): Promise<unknown>
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

// ---------------------------------------------------------------------------------------------
// Fixtures: a localhost page, a cross-origin frame on 127.0.0.2, and a download.
// ---------------------------------------------------------------------------------------------

/** Every value the fixture page reported from its password field. */
const recorded: string[] = []
/** Every download request the fixture served, so a stopped download is distinguishable from a click that never ran. */
const downloadHits: { at: number; path: string }[] = []

const simple = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body>
  <h1>Browser E2E</h1>
  <button id="go">Click me</button>
  <input id="pw" type="password" aria-label="Password" />
  <p id="status">idle</p>
  <a id="file" href="/download">Get the report</a>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      document.getElementById("status").textContent = "clicked"
    })
    // The fixture records what reaches the password field, so a test can prove a rejected fill never landed.
    const pw = document.getElementById("pw")
    const send = () => fetch("/__record", { method: "POST", body: pw.value })
    pw.addEventListener("input", send)
    pw.addEventListener("change", send)
  </script>
</body></html>`

const framed = (frameOrigin: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body style="margin:0">
  <iframe src="${frameOrigin}/" style="position:fixed;left:0;top:0;width:320px;height:200px;border:0"></iframe>
  <h1 style="position:fixed;left:400px;top:0">Browser E2E</h1>
  <button id="go" style="position:fixed;left:400px;top:60px">Click me</button>
  <script>document.getElementById("go").addEventListener("click", () => { document.body.style.background = "#00ff00" })</script>
</body></html>`

const userPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>User tab</title></head>
<body><h1>USER PAGE</h1></body></html>`

const downloadPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Download E2E</title></head>
<body>
  <h1>Download E2E</h1>
  <a id="file" href="/download">Get the report</a>
</body></html>`

const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/__record") {
      recorded.push(await request.text().catch(() => ""))
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/download") {
      downloadHits.push({ at: Date.now(), path: url.pathname })
      return new Response("report-body", {
        headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="report.txt"' },
      })
    }
    if (url.pathname === "/download-second") {
      downloadHits.push({ at: Date.now(), path: url.pathname })
      return new Response("second-body", {
        headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="second.txt"' },
      })
    }
    if (url.pathname === "/download-two") {
      return new Response(
        `<!doctype html><html><head><title>Two downloads</title></head><body>
          <h1>Two downloads</h1><a id="file" href="/download">Get the report</a>
          <script>
            // The approved link starts its own file; the same click also starts a second, different one.
            document.getElementById('file').addEventListener('click', () => {
              const extra = document.createElement('a')
              extra.href = '/download-second'
              extra.download = 'second.txt'
              document.body.appendChild(extra)
              extra.click()
            })
          </script>
        </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      )
    }
    if (url.pathname === "/download-late") {
      // The click itself starts no download; the attachment appears about 1.5 s later (after the click's wait).
      await Bun.sleep(1500)
      downloadHits.push({ at: Date.now(), path: url.pathname })
      return new Response("report-body", {
        headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="report.txt"' },
      })
    }
    if (url.pathname === "/download-late-page") {
      return new Response(
        `<!doctype html><html><head><title>Late download</title></head><body>
          <h1>Late download</h1><a id="file" href="/download-late">Get the report</a>
        </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      )
    }
    if (url.pathname === "/user") return new Response(userPage, { headers: { "content-type": "text/html; charset=utf-8" } })
    if (url.pathname === "/download-page") {
      return new Response(downloadPage, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    if (url.pathname === "/framed") {
      return new Response(framed(frame.url.origin), { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    return new Response(simple, { headers: { "content-type": "text/html; charset=utf-8" } })
  },
})

const frame = Bun.serve({
  hostname: "127.0.0.2",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/public") {
      return new Response(
        `<!doctype html><html><head><title>Public</title></head><body><h1 id="marker">${PUBLIC_MARKER}</h1></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      )
    }
    return new Response(
      `<!doctype html><html><head><title>Frame</title></head>
<body style="margin:0;background:#ff0000"><h1 id="marker">${MARKER}</h1></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    )
  },
})

const publicOrigin = frame.url.origin
const localOrigin = fixture.url.origin

// ---------------------------------------------------------------------------------------------
// Scripted model: one Chat Completions endpoint that answers from a per-scenario plan.
// ---------------------------------------------------------------------------------------------

type Call = { name: string; args: unknown }
type Step = { calls: Call[]; results: string[]; images: string[] }

function field(value: unknown, key: string): unknown {
  return record(value)?.[key]
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part) => {
      const type = field(part, "type")
      const text = field(part, "text")
      return type === "text" && typeof text === "string" ? [text] : []
    })
    .join("\n")
}

function callsOf(toolCalls: unknown): Call[] {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.flatMap((call) => {
    const fn = field(call, "function")
    const name = field(fn, "name")
    if (typeof name !== "string") return []
    const raw = field(fn, "arguments")
    let args: unknown = raw
    try {
      args = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      args = raw
    }
    return [{ args, name }]
  })
}

/** The first PNG data URL anywhere in a message part (the CLI may send a file part, an image part, or a string). */
function pngOf(value: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined
  if (typeof value === "string") return value.startsWith("data:image/png;base64,") ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pngOf(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const object = record(value)
  if (object === undefined) return undefined
  for (const key of ["uri", "url", "data", "image_url", "source"]) {
    const found = pngOf(object[key], depth + 1)
    if (found) return found
  }
  return undefined
}

function read(messages: unknown): Step {
  const calls: Call[] = []
  const results: string[] = []
  const images: string[] = []
  if (!Array.isArray(messages)) return { calls, images, results }
  for (const message of messages) {
    const role = field(message, "role")
    if (role === "assistant") calls.push(...callsOf(field(message, "tool_calls")))
    if (role !== "tool") continue
    const content = field(message, "content")
    results.push(textOf(content))
    const png = pngOf(content)
    if (png) images.push(png)
  }
  return { calls, images, results }
}

const chunk = (model: string, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish, index: 0 }], id: "local", model, object: "chat.completion.chunk" })}\n\n`

const toolCall = (model: string, name: string, args: unknown) =>
  [
    chunk(
      model,
      {
        role: "assistant",
        tool_calls: [
          { function: { arguments: JSON.stringify(args), name }, id: `call_${name}_${Date.now()}`, index: 0, type: "function" },
        ],
      },
      null,
    ),
    chunk(model, {}, "tool_calls"),
    `data: ${JSON.stringify({ choices: [], id: "local", model, object: "chat.completion.chunk", usage: { completion_tokens: 2, prompt_tokens: 10, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")

const answer = (model: string, text: string) =>
  [
    chunk(model, { content: text, role: "assistant" }, null),
    chunk(model, {}, "stop"),
    `data: ${JSON.stringify({ choices: [], id: "local", model, object: "chat.completion.chunk", usage: { completion_tokens: 2, prompt_tokens: 10, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")

type Plan = (step: Step) => Promise<Call | undefined> | Call | undefined
let activePlan: Plan | undefined
const history: Step[] = []

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })

const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? (field(body, "model") as string) : "local"
    const declared = field(body, "tools")
    const tools = Array.isArray(declared)
      ? declared.flatMap((tool) => {
          const id = field(field(tool, "function"), "name")
          return typeof id === "string" ? [id] : []
        })
      : []
    if (!tools.some((tool) => tool.startsWith("browser_")) && !tools.includes("execute")) {
      return sse(answer(name, "Browser E2E"))
    }

    const step = read(field(body, "messages"))
    history.push(step)
    const next = activePlan === undefined ? undefined : await activePlan(step)
    if (next === undefined) return sse(answer(name, "Browser E2E finished"))
    // #16317 registers the browser tools as a Code Mode namespace: the model reaches them through `execute`.
    if (tools.some((tool) => tool.startsWith("browser_"))) return sse(toolCall(name, next.name, next.args))
    const method = next.name.startsWith("browser_") ? next.name.slice("browser_".length) : next.name
    const code = `return await tools.browser.${method}(${JSON.stringify(next.args)})`
    return sse(toolCall(name, "execute", { code }))
  },
})

// ---------------------------------------------------------------------------------------------
// Chromium: the built extension, headed under xvfb, with the settings page driven like a user.
// ---------------------------------------------------------------------------------------------

const failures: string[] = []
function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message)
}

async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeout = 20_000, label = "condition"): Promise<T> {
  const deadline = Date.now() + timeout
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      last = error
    }
    await Bun.sleep(50)
  }
  throw new Error(`${label} was not met before ${timeout}ms${last === undefined ? "" : `: ${String(last)}`}`)
}

async function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const server = net.createServer()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    resolve(typeof address === "object" && address !== null ? address.port : 0)
    server.close()
  })
  return promise
}

/** Extension service-worker console and exceptions, through the browser-level CDP session. */
class ServiceWorkerLog {
  readonly lines: string[] = []
  private attached = new Map<string, string>()
  private nextId = 1
  private session: CdpSession | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly browser: { newBrowserCDPSession(): Promise<CdpSession> }) {}

  async start() {
    try {
      const session = await this.browser.newBrowserCDPSession()
      this.session = session
      session.on("Target.receivedMessageFromTarget", (event) => this.receive(event))
      session.on("Target.detachedFromTarget", (event) => {
        const sessionId = record(event)?.["sessionId"]
        if (typeof sessionId === "string") this.attached.delete(sessionId)
      })
      await session.send("Target.setDiscoverTargets", { discover: true })
      session.on("Target.targetCreated", (event) => {
        const info = record(record(event)?.["targetInfo"])
        if (info && this.mine(info)) void this.attach(String(info["targetId"]))
      })
      await this.attachAll()
      this.timer = setInterval(() => void this.attachAll(), 2_000)
      this.push(`[relay] browser CDP session ready; ${this.attached.size} service worker target(s) attached`)
      return true
    } catch (error) {
      this.lines.push(`[relay] cannot attach to the browser's CDP session: ${String(error)}`)
      return false
    }
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private mine(info: Record<string, unknown>) {
    return info["type"] === "service_worker" && typeof info["url"] === "string" && info["url"].includes(extensionId)
  }

  private async attachAll() {
    if (!this.session) return
    try {
      const targets = record(await this.session.send("Target.getTargets"))
      const infos = targets?.["targetInfos"]
      if (!Array.isArray(infos)) return
      for (const info of infos) {
        const value = record(info)
        if (value && this.mine(value)) await this.attach(String(value["targetId"]))
      }
    } catch (error) {
      this.lines.push(`[relay] cannot list targets: ${String(error)}`)
    }
  }

  private async attach(targetId: string) {
    if (!this.session || this.attached.has(targetId)) return
    try {
      const attached = record(await this.session.send("Target.attachToTarget", { flatten: false, targetId }))
      const sessionId = attached?.["sessionId"]
      if (typeof sessionId !== "string") return
      this.attached.set(targetId, sessionId)
      await this.session.send("Target.sendMessageToTarget", {
        message: JSON.stringify({ id: this.nextId++, method: "Runtime.enable", params: {} }),
        sessionId,
      })
    } catch (error) {
      this.lines.push(`[relay] cannot attach to ${targetId}: ${String(error)}`)
    }
  }

  private receive(event: unknown) {
    const message = record(event)?.["message"]
    if (typeof message !== "string") return
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const method = field(parsed, "method")
    const params = record(field(parsed, "params"))
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(params?.["args"])
        ? params["args"].map((arg: unknown) => {
            const entry = record(arg)
            return entry?.["value"] ?? entry?.["description"] ?? entry?.["type"]
          })
        : []
      this.push(`[${String(params?.["type"] ?? "log")}] ${args.join(" ")}`)
    }
    if (method === "Runtime.exceptionThrown") {
      const details = record(params?.["exceptionDetails"])
      const exception = record(details?.["exception"])
      this.push(`[exception] ${String(exception?.["description"] ?? details?.["text"] ?? "unknown exception")}`)
    }
  }

  private push(line: string) {
    this.lines.push(line.slice(0, 2_000))
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500)
  }
}

let extensionId = ""
let context: Context
let panel: Page
let worker: Worker
let swLog: ServiceWorkerLog | undefined

async function launch(base: string, options: { extension?: string; downloads?: string } = {}) {
  const directory = options.extension ?? extensionDirectory
  await fs.access(path.join(directory, "manifest.json"))
  if (!existsSync(executablePath)) throw new Error(`no Chromium at ${executablePath}; install playwright-core's browser or set E2E_CHROMIUM`)
  context = (await chromium.launchPersistentContext(path.join(base, "profile"), {
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
      "--disable-blink-features=AutomationControlled",
      ...(process.env.E2E_DSF === undefined ? [] : [`--force-device-scale-factor=${process.env.E2E_DSF}`]),
    ],
    executablePath,
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: process.env.E2E_DSF === undefined ? { height: 900, width: 1280 } : null,
    ...(options.downloads === undefined ? {} : { downloadsPath: options.downloads }),
  })) as unknown as Context
  context.setDefaultTimeout(20_000)
  const existing = context.serviceWorkers()[0]
  worker = existing ?? (await context.waitForEvent("serviceworker"))
  extensionId = new URL(worker.url()).host
  const browser = context.browser()
  if (browser) {
    swLog = new ServiceWorkerLog(browser)
    await swLog.start()
  }
  return { extensionId }
}

/**
 * A copy of the built extension with the optional `downloads` permission promoted to required: automation cannot
 * answer Chrome's optional-permission prompt, and this is the state it is in after the user accepts it (the cloud
 * e2e does the same).
 */
async function promoteDownloadsCopy(source: string, target: string) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.cp(source, target, { recursive: true })
  const manifestPath = path.join(target, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    optional_permissions?: string[]
    permissions?: string[]
  }
  const optional = (manifest.optional_permissions ?? []).filter((permission) => permission !== "downloads")
  const permissions = [...(manifest.permissions ?? [])]
  if (!permissions.includes("downloads")) permissions.push("downloads")
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, optional_permissions: optional, permissions }, null, 2),
  )
  return target
}

/** Turns on "Allow local agents" through the extension's own settings page, as a signed-in user would. */
async function enableLocalAgents(_base: string) {
  // Auth validation and organization fetches: the settings header only exists for a signed-in session.
  await context.route("https://app.kilo.ai/api/user", (route) =>
    route.fulfill({ json: { google_user_email: "e2e@kilo.ai" }, status: 200 }),
  )
  await context.route("https://app.kilo.ai/api/organizations", (route) =>
    route.fulfill({ json: { organizations: [] }, status: 200 }),
  )
  await context.route(
    (url) => url.origin === "https://app.kilo.ai" && url.pathname.startsWith("/api/trpc/"),
    (route) => route.fulfill({ json: {}, status: 200 }),
  )
  // A real user answers the optional-permission prompt; automation cannot. The page grants it the way an accepted
  // prompt would, keeping the flow deterministic (loopback pairing does not need the permission).
  await context.addInitScript({
    content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
  })
  panel = await context.newPage()
  panel.setDefaultTimeout(20_000)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await seedAuth()
  await panel.reload()
  const settings = panel.getByRole("button", { name: "Settings" })
  await settings.waitFor()
  await settings.click()
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  await toggle.waitFor()
  await until(async () => (await toggle.getAttribute("aria-checked")) === "false", 10_000, "the switch starts off")
  await toggle.click()
  await until(async () => (await toggle.getAttribute("aria-checked")) === "true", 10_000, "the switch turns on")
  const stored = await worker.evaluate(() => chrome.storage.local.get("kiloLocalAgentSettings"))
  expect(record(stored)?.["kiloLocalAgentSettings"] !== undefined && record(record(stored)?.["kiloLocalAgentSettings"])?.["enabled"] === true, `the switch did not persist: ${JSON.stringify(stored)}`)
}

async function seedAuth() {
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        // The extension pages expose `chrome`; the ambient DOM types in this package do not.
        const global = globalThis as { chrome?: ChromeExtensionApi }
        const api = global.chrome
        if (!api?.storage?.local) {
          reject(new Error("chrome.storage.local is unavailable"))
          return
        }
        api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "e2e@kilo.ai" } }, () => {
          const message = api.runtime?.lastError?.message
          if (message) reject(new Error(message))
          else resolve()
        })
      }),
  )
}

type ChromeExtensionApi = {
  runtime?: { lastError?: { message?: string } }
  storage?: { local?: { set(items: Record<string, unknown>, callback: () => void): void } }
}

/** A tab the user opened before the run: no opener, so no session may ever claim it. */
async function openUserTab(url: string): Promise<number> {
  const cdp = await context.newCDPSession(panel)
  await cdp.send("Target.createTarget", { newWindow: false, url })
  return await until(async () => {
    const tabs = await tabsOf()
    return tabs.find((tab) => tab.url === url)?.id
  }, 10_000, "the user tab appears")
}

type TabInfo = { active?: boolean; groupId?: number; id?: number; title?: string; url?: string }
type GroupInfo = { collapsed?: boolean; color?: string; id?: number; title?: string }

/** The `chrome.tabs.Tab` fields this harness reads, validated field by field. */
function tabOf(value: unknown): TabInfo {
  const tab = record(value) ?? {}
  return {
    ...(typeof tab["active"] === "boolean" ? { active: tab["active"] } : {}),
    ...(typeof tab["groupId"] === "number" ? { groupId: tab["groupId"] } : {}),
    ...(typeof tab["id"] === "number" ? { id: tab["id"] } : {}),
    ...(typeof tab["title"] === "string" ? { title: tab["title"] } : {}),
    ...(typeof tab["url"] === "string" ? { url: tab["url"] } : {}),
  }
}

function groupOf(value: unknown): GroupInfo {
  const group = record(value) ?? {}
  return {
    ...(typeof group["collapsed"] === "boolean" ? { collapsed: group["collapsed"] } : {}),
    ...(typeof group["color"] === "string" ? { color: group["color"] } : {}),
    ...(typeof group["id"] === "number" ? { id: group["id"] } : {}),
    ...(typeof group["title"] === "string" ? { title: group["title"] } : {}),
  }
}

async function tabsOf(): Promise<TabInfo[]> {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}))
  return Array.isArray(tabs) ? tabs.map(tabOf) : []
}

async function tabState() {
  const tabs = await tabsOf()
  const groups = await worker.evaluate(() => chrome.tabGroups.query({}))
  return { groups: Array.isArray(groups) ? groups.map(groupOf) : [], tabs }
}

// ---------------------------------------------------------------------------------------------
// Hub: start `kilo2 browser hub --loopback`, ask it for a pairing URL over its CLI socket, open that page.
// ---------------------------------------------------------------------------------------------

type HubEntry = { hubId: string; paired?: boolean; port?: number; socket?: string }

type Hub = {
  child: { exited: Promise<number>; kill(signal?: string): void }
  entry: () => Promise<HubEntry | undefined>
  log: { text: string }
  port: number
  stop: () => Promise<void>
}

function environment(root: string, settings: Settings) {
  const run = path.join(root, "run")
  return {
    ...process.env,
    HOME: root,
    KILO_API_KEY: "",
    KILO_AUTH_CONTENT: "",
    KILO_BROWSER_DATA_DIR: path.join(root, "data", "kilo2", "browser"),
    KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
    KILO_BROWSER_RUN_DIR: path.join(run, "browser"),
    KILO_CONFIG_CONTENT: JSON.stringify(config(settings)),
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
    NO_PROXY: "127.0.0.1,127.0.0.2,localhost",
    PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}`,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_RUNTIME_DIR: run,
    XDG_STATE_HOME: path.join(root, "state"),
    no_proxy: "127.0.0.1,127.0.0.2,localhost",
  }
}

async function prepareHome(root: string) {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(path.join(root, "bin"), { recursive: true })
  await fs.mkdir(path.join(root, "run"), { recursive: true, mode: 0o700 })
  // The CLI's system opener is xdg-open on Linux; a no-op keeps an unpaired run from waiting on it.
  await fs.writeFile(path.join(root, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
}

async function readHubEntry(root: string): Promise<HubEntry | undefined> {
  const directory = path.join(root, "run", "browser", "hubs")
  const files = await fs.readdir(directory).catch(() => [] as string[])
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      return JSON.parse(await fs.readFile(path.join(directory, file), "utf8")) as HubEntry
    } catch {
      // A half-written registry file is rewritten by the hub; wait for the next read.
    }
  }
  return undefined
}

function tap(stream: ReadableStream<Uint8Array>, into: { text: string }) {
  void (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        into.text += decoder.decode(value, { stream: true })
      }
    } catch {
      // The stream closes when the process exits.
    }
  })()
}

async function startHub(root: string, settings: Settings): Promise<Hub> {
  const port = await freePort()
  const log = { text: "" }
  const child = Bun.spawn([binary, "browser", "hub", "--loopback", "--port", String(port)], {
    cwd: root,
    env: environment(root, settings),
    stderr: "pipe",
    stdout: "pipe",
  })
  tap(child.stdout as ReadableStream<Uint8Array>, log)
  tap(child.stderr as ReadableStream<Uint8Array>, log)
  await until(async () => readHubEntry(root), 30_000, "the hub registers itself")
  return {
    child,
    entry: () => readHubEntry(root),
    log,
    port,
    stop: async () => {
      try {
        child.kill("SIGTERM")
      } catch {
        // Already gone.
      }
      await Promise.race([child.exited, Bun.sleep(5_000)])
    },
  }
}

/** One JSON-RPC call the hub answers itself, over the same 4-byte-framed socket the CLI uses. */
async function hubRequest(socketPath: string, method: string, params: unknown): Promise<unknown> {
  const socket = net.createConnection(socketPath)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
  let buffer = Buffer.alloc(0)
  const timer = setTimeout(() => {
    socket.destroy()
    reject(new Error(`hub ${method} timed out`))
  }, 15_000)
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const text = buffer.subarray(4, 4 + length).toString("utf8")
      buffer = buffer.subarray(4 + length)
      let frame: unknown
      try {
        frame = JSON.parse(text)
      } catch {
        continue
      }
      if (field(frame, "type") !== "rpc") continue
      const message = record(field(frame, "message"))
      if (message?.["id"] !== 1) continue
      clearTimeout(timer)
      socket.end()
      const error = record(message["error"])
      if (error) reject(new Error(String(error["message"])))
      else resolve(message["result"])
      return
    }
  })
  socket.once("error", (error: Error) => {
    clearTimeout(timer)
    reject(error)
  })
  const body = Buffer.from(JSON.stringify({ message: { id: 1, jsonrpc: "2.0", method, params }, type: "rpc" }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  socket.write(Buffer.concat([header, body]))
  return promise
}

/** The CLI's pairing step: ask the hub for its one-time URL and open the page in this browser. */
async function pair(hub: Hub) {
  const entry = await hub.entry()
  if (entry?.socket === undefined) throw new Error("the hub registry has no socket")
  const answer = record(await hubRequest(entry.socket, "pairing.url", {}))
  const url = answer?.["url"]
  if (typeof url !== "string") throw new Error("the hub returned no pairing URL")
  const cdp = await context.newCDPSession(panel)
  // A tab with no opener: the extension observes the navigation and closes it after redeeming the token.
  await cdp.send("Target.createTarget", { newWindow: true, url })
  await until(async () => {
    const current = await hub.entry()
    return current?.paired === true ? current : undefined
  }, 30_000, "the extension pairs and connects")
  return url
}

// ---------------------------------------------------------------------------------------------
// CLI runs: a fresh home, a fresh hub, the scripted model, and `kilo2 run`.
// ---------------------------------------------------------------------------------------------

type Rule = { action: string; effect: "allow" | "ask" | "deny"; resource: string }
type Settings = { allowSensitive?: boolean; auto?: boolean; rules?: Rule[]; strict?: boolean }

/** A non-interactive run cannot answer a tool-level ask, so the harness config allows the tools it drives. */
const TOOL_RULES: Rule[] = [
  "execute",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_tabs",
  "browser_take_screenshot",
].map((action) => ({ action, effect: "allow" as const, resource: "*" }))

/** The built-in defaults the SPEC documents for the localhost family; without them every act reads as an ask. */
const LOCALHOST_RULES: Rule[] = [
  { action: "browser", effect: "allow", resource: "*:http://localhost:*" },
  { action: "browser", effect: "allow", resource: "*:http://127.0.0.1:*" },
  { action: "browser", effect: "allow", resource: "*:http://*.localhost:*" },
  { action: "browser", effect: "allow", resource: "*:https://localhost:*" },
]

function config(settings: Settings) {
  return {
    model: "local/echo",
    providers: {
      local: {
        models: { echo: { limit: { context: 200_000, output: 4_000 }, name: "Echo" } },
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { apiKey: "local-key", baseURL: `${model.url.origin}/v1` },
      },
    },
    browser: {
      backend: "extension",
      observation: "full",
      ...(settings.allowSensitive ? { allow_sensitive: true } : {}),
    },
    // A non-interactive run cannot answer an ask, so everything the scenario is not testing is allowed explicitly.
    permissions: settings.strict
      ? [...TOOL_RULES, ...LOCALHOST_RULES, ...(settings.rules ?? [])]
      : [{ action: "*", effect: "allow" as const, resource: "*" }, ...(settings.rules ?? [])],
  }
}

let runCounter = 0

type Run = {
  code: number
  hub: Hub
  last: Step
  pngs: string[]
  root: string
  stderr: string
  steps: Step[]
  stdout: string
}

type RunOptions = { pair?: boolean; stop?: () => Promise<void> }

async function run(plan: Plan, settings: Settings, options: RunOptions = {}): Promise<Run> {
  runCounter += 1
  const root = path.join(base, `run-${runCounter}`)
  await prepareHome(root)
  const hub = await startHub(root, settings)
  try {
    if (options.pair !== false) await pair(hub)
    history.length = 0
    activePlan = plan
    const child = Bun.spawn(
      [
        binary,
        "run",
        "Check the browser bridge.",
        "--model",
        "local/echo",
        "--standalone",
        "--format",
        "json",
        ...(settings.auto ? ["--auto"] : []),
      ],
      {
        cwd: root,
        env: environment(root, settings),
        stderr: "pipe",
        stdout: "pipe",
        timeout: 240_000,
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ])
    activePlan = undefined
    const steps = [...history]
    const last = steps.at(-1) ?? { calls: [], images: [], results: [] }
    // The screenshot arrives in the run's tool event as a file part with a data URI; the model message may carry only
    // a text reference, so the event stream is the reliable source.
    const pngs = [...stdout.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)].map((match) => match[0])
    return { code, hub, last, pngs, root, stderr, steps, stdout }
  } finally {
    await hub.stop()
  }
}

/** The ref a snapshot reported for one role and name, e.g. `button "Click me"`. */
function refOf(snapshot: string, pattern: RegExp): string | undefined {
  return pattern.exec(snapshot)?.[1]
}

function decodePng(dataUrl: string | undefined): Png.Image | undefined {
  if (!dataUrl) return undefined
  const comma = dataUrl.indexOf(",")
  if (comma < 0) return undefined
  try {
    return Png.decode(Buffer.from(dataUrl.slice(comma + 1), "base64"))
  } catch {
    return undefined
  }
}

function pixel(image: Png.Image | undefined, x: number, y: number) {
  if (!image) return undefined
  const at = (y * image.width + x) * image.channels
  return [image.data[at], image.data[at + 1], image.data[at + 2]]
}

/** A JSON object the tool rendered, possibly inside observation sections. */
function jsonOf(text: string): unknown {
  const array = /"tabs"\s*:\s*(\[[\s\S]*?\])/.exec(text)
  if (array) {
    try {
      return { tabs: JSON.parse(array[1]) }
    } catch {
      return undefined
    }
  }
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
  } catch {
    return undefined
  }
}

/** The run's tool events in order, with the CLI's own start/end timestamps. */
function toolTimes(stdout: string): { start: number; end: number }[] {
  const times: { start: number; end: number }[] = []
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (field(event, "type") !== "tool_use") continue
    const part = record(field(event, "part"))
    if (part?.["type"] !== "tool") continue
    const time = record(record(part["state"])?.["time"])
    if (typeof time?.["start"] === "number" && typeof time?.["end"] === "number") {
      times.push({ start: time["start"], end: time["end"] })
    }
  }
  return times
}

function report(results: Record<string, unknown>) {
  return {
    chromium: executablePath,
    extension: extensionDirectory,
    extensionId,
    failures,
    scenario,
    serviceWorker: swLog?.lines.slice(-120) ?? [],
    ...results,
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

async function navigateSnapshot() {
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) return { args: {}, name: "browser_snapshot" }
    return undefined
  }
  const result = await run(plan, {})
  const results = result.last.results
  const snapshot = results[1] ?? ""
  const clicked = results[2] ?? ""
  const after = results[3] ?? ""
  expect(snapshot.includes('button "Click me"'), `the snapshot has no button:\n${snapshot.slice(0, 500)}`)
  expect(
    clicked.includes("clicked") || after.includes("clicked"),
    `the click did not change the page:\n${clicked.slice(0, 500)}\n---\n${after.slice(0, 500)}`,
  )
  expect(result.code === 0, `run exited ${result.code}\n${result.stderr.slice(-1_500)}`)
  return {
    hubLog: result.hub.log.text.slice(-2_000),
    results: results.map((value) => value.slice(0, 500)),
    run: { code: result.code, stderr: result.stderr.slice(-2_000), stdout: result.stdout.slice(-6_000) },
  }
}

async function permission() {
  // 127.0.0.2 is not the localhost family, so the default rules ask for it.
  const refused = await run(
    (step) => (step.results.length === 0 ? { args: { url: `${publicOrigin}/public` }, name: "browser_navigate" } : undefined),
    { strict: true },
  )
  const refusedResult = refused.last.results[0] ?? ""
  expect(
    refusedResult.includes("cannot ask the user for permission") || refusedResult.includes("Permission denied"),
    `a non-localhost navigation was not refused:\n${refusedResult.slice(0, 500)}`,
  )
  expect(!refusedResult.includes(PUBLIC_MARKER), `the refused navigation leaked the page:\n${refusedResult.slice(0, 500)}`)

  const rules: Rule[] = [
    { action: "browser", effect: "allow", resource: `navigate:${publicOrigin}` },
    { action: "browser", effect: "allow", resource: `read:${publicOrigin}` },
  ]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${publicOrigin}/public` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    return undefined
  }, { rules, strict: true })
  const navigated = allowed.last.results[0] ?? ""
  const snapshot = allowed.last.results[1] ?? ""
  expect(navigated.includes(publicOrigin), `the allowed navigation did not report the URL:\n${navigated.slice(0, 500)}`)
  expect(snapshot.includes(PUBLIC_MARKER), `the granted page's content is missing:\n${snapshot.slice(0, 500)}`)
  return {
    allowed: { snapshot: snapshot.slice(0, 500), stdout: allowed.stdout.slice(-1_000) },
    hubLogs: [refused.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    refused: refusedResult.slice(0, 500),
  }
}

async function frames() {
  const dpr = Number(process.env.E2E_DPR ?? process.env.E2E_DSF ?? "1")
  const userPage = await context.newPage()
  await userPage.goto(`${localOrigin}/user`)
  const dprUser = await userPage.evaluate(() => window.devicePixelRatio)
  const buttonRef = (snapshot: string) => refOf(snapshot, /button "Click me" \[ref=([^\]]+)\]/)
  const withheld = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = buttonRef(step.results[1] ?? "")
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    // Both screenshots follow the click: the mask must land on the right pixels in each scale.
    if (step.results.length === 3) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    if (step.results.length === 4) return { args: { scale: "device", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, {})
  const snapshot = withheld.last.results[1] ?? ""
  const clicked = withheld.last.results[2] ?? ""
  const agentPage = context.pages().find((page) => page.url().includes("/framed"))
  const dprAgent = agentPage === undefined ? undefined : await agentPage.evaluate(() => window.devicePixelRatio)
  const css = agentPage === undefined ? undefined : await agentPage.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth }))
  const cssImage = decodePng(withheld.pngs[0] ?? withheld.last.images[0])
  const deviceImage = decodePng(withheld.pngs[1] ?? withheld.last.images[1])
  const maskedCss = pixel(cssImage, 160, 100)
  const maskedDevice = pixel(deviceImage, 160 * dpr, 100 * dpr)
  const outsideCss = pixel(cssImage, 340, 100)
  const outsideDevice = pixel(deviceImage, 340 * dpr, 100 * dpr)
  expect(dprUser === dpr, `the user page reports devicePixelRatio ${String(dprUser)}, expected ${dpr}`)
  expect(dprAgent === dpr, `the agent tab reports devicePixelRatio ${String(dprAgent)}, expected ${dpr}`)
  expect(
    cssImage?.width === Math.round(css?.width ?? 1280),
    `the css screenshot is ${String(cssImage?.width)} px wide, expected the CSS viewport ${String(css?.width)}`,
  )
  expect(
    deviceImage?.width === Math.round((css?.width ?? 1280) * dpr),
    `the device screenshot is ${String(deviceImage?.width)} px wide, expected ${Math.round((css?.width ?? 1280) * dpr)}`,
  )
  expect(
    snapshot.includes(`[origin withheld: ${publicOrigin}]`),
    `the snapshot did not withhold the frame:\n${snapshot.slice(0, 600)}`,
  )
  expect(!snapshot.includes(MARKER), `the withheld frame's marker reached the snapshot:\n${snapshot.slice(0, 600)}`)
  expect(clicked.length > 0, "the click before the framed screenshot did not run")
  expect(
    maskedCss !== undefined && maskedCss.every((value) => value < 40) && maskedDevice !== undefined && maskedDevice.every((value) => value < 40),
    `the iframe center after the click is not masked in both scales: css=${JSON.stringify(maskedCss)} device=${JSON.stringify(maskedDevice)}`,
  )
  expect(
    outsideCss !== undefined && outsideCss.some((value) => value > 60) && outsideDevice !== undefined && outsideDevice.some((value) => value > 60),
    `the pixel just outside the iframe is black in a scale: css=${JSON.stringify(outsideCss)} device=${JSON.stringify(outsideDevice)}`,
  )

  const rules: Rule[] = [{ action: "browser", effect: "allow", resource: `read:${publicOrigin}` }]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      // The withheld iframe carries a ref now; targeting it asks for read:<frame origin>.
      const ref = refOf(step.results[1] ?? "", /iframe \[ref=([^\]]+)\]/)
      return ref ? { args: { target: ref }, name: "browser_snapshot" } : undefined
    }
    if (step.results.length === 3) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 4) {
      const ref = buttonRef(step.results[3] ?? "")
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 5) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    if (step.results.length === 6) return { args: { scale: "device", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, { rules })
  const granted = allowed.last.results[3] ?? ""
  const grantedClick = allowed.last.results[4] ?? ""
  const grantedCss = decodePng(allowed.pngs[0] ?? allowed.last.images[0])
  const grantedDevice = decodePng(allowed.pngs[1] ?? allowed.last.images[1])
  const revealedCss = pixel(grantedCss, 160, 100)
  const revealedDevice = pixel(grantedDevice, 160 * dpr, 100 * dpr)
  const grantedOutsideCss = pixel(grantedCss, 340, 100)
  const grantedOutsideDevice = pixel(grantedDevice, 340 * dpr, 100 * dpr)
  expect(granted.includes(MARKER), `the granted frame's marker is missing:\n${granted.slice(0, 600)}`)
  expect(grantedClick.length > 0, "the click before the granted screenshot did not run")
  expect(
    revealedCss !== undefined && revealedCss[0] > 200 && revealedCss[1] < 80 && revealedCss[2] < 80 &&
      revealedDevice !== undefined && revealedDevice[0] > 200 && revealedDevice[1] < 80 && revealedDevice[2] < 80,
    `the granted frame is not visible in the screenshot after the click: css=${JSON.stringify(revealedCss)} device=${JSON.stringify(revealedDevice)}`,
  )
  expect(
    grantedOutsideCss !== undefined && grantedOutsideCss.some((value) => value > 60) &&
      grantedOutsideDevice !== undefined && grantedOutsideDevice.some((value) => value > 60),
    `the pixel just outside the iframe is black in the granted run: css=${JSON.stringify(grantedOutsideCss)} device=${JSON.stringify(grantedOutsideDevice)}`,
  )
  return {
    granted: granted.slice(0, 600),
    hubLogs: [withheld.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    css,
    dprAgent,
    dprUser,
    maskedCss,
    maskedDevice,
    revealedCss,
    revealedDevice,
    results: withheld.last.results.map((value) => value.slice(0, 700)),
    screenshot: {
      css: { height: cssImage?.height, width: cssImage?.width },
      device: { height: deviceImage?.height, width: deviceImage?.width },
    },
    snapshot: snapshot.slice(0, 600),
  }
}

async function sensitive() {
  recorded.length = 0
  const basePlan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      // The click establishes the act grant, so the type's own call is where the sensitive step is classified.
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) {
      const ref = refOf(step.results[1] ?? "", /textbox "Password" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the password field", target: ref, text: PASSWORD_VALUE }, name: "browser_type" } : undefined
    }
    return undefined
  }

  const refused = await run(basePlan, {})
  const typed = refused.last.results[3] ?? ""
  expect(
    typed.includes("cannot ask the user for permission") || typed.includes("Permission denied"),
    `the password fill was not refused:\n${typed.slice(0, 500)}`,
  )
  expect(!recorded.includes(PASSWORD_VALUE), `the fixture recorded the rejected fill: ${JSON.stringify(recorded)}`)

  recorded.length = 0
  const allowed = await run(basePlan, { allowSensitive: true })
  await until(() => (recorded.includes(PASSWORD_VALUE) ? true : undefined), 5_000, "the fixture records the allowed fill")
  expect(recorded.includes(PASSWORD_VALUE), `the fixture did not record the allowed fill: ${JSON.stringify(recorded)}`)
  return {
    allowed: (allowed.last.results[3] ?? "").slice(0, 400),
    hubLogs: [refused.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    recorded: [...recorded],
    refused: typed.slice(0, 500),
  }
}

async function group() {
  const userUrl = `${localOrigin}/user`
  const userTabId = await openUserTab(userUrl)
  const userBefore = (await tabState()).tabs.find((tab) => tab.id === userTabId)
  let during: Awaited<ReturnType<typeof tabState>> | undefined
  let listed: string | undefined

  const result = await run((step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      listed = step.results[2]
      return { args: { action: "list" }, name: "browser_tabs" }
    }
    if (step.results.length === 3) {
      listed = step.results[2]
      return (async () => {
        during = await tabState()
        const parsed = jsonOf(step.results[2] ?? "")
        const tabs = field(parsed, "tabs")
        const user = Array.isArray(tabs) ? tabs.find((tab) => field(tab, "url") === userUrl) : undefined
        const withheld = Array.isArray(tabs) ? tabs.find((tab) => field(tab, "url") === "[origin withheld]") : undefined
        const index = field(user ?? withheld, "index")
        return typeof index === "number" ? { args: { action: "select", index }, name: "browser_tabs" } : undefined
      })()
    }
    return undefined
  }, {})
  during ??= await tabState()

  const after = await tabState()
  const userAfter = after.tabs.find((tab) => tab.id === userTabId)
  const userDuring = during.tabs.find((tab) => tab.id === userTabId)
  const kiloGroup = during.groups.find(
    (candidate) =>
      typeof candidate.title === "string" &&
      candidate.title.startsWith("Kilo · ") &&
      candidate.title !== "Kilo · ended" &&
      candidate.collapsed !== true,
  )
  const agentTab = during.tabs.find((tab) => kiloGroup !== undefined && tab.groupId === kiloGroup.id)
  const refused = result.last.results[3] ?? ""

  expect(userBefore?.groupId === -1, `the user tab was already grouped: ${JSON.stringify(userBefore)}`)
  expect(userAfter !== undefined, "the user tab disappeared")
  expect(userDuring?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userDuring)}`)
  expect(userAfter?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userAfter)}`)
  expect(userAfter?.url === userUrl, `the user tab was navigated: ${JSON.stringify(userAfter)}`)
  expect(kiloGroup !== undefined, `no live "Kilo · …" tab group: ${JSON.stringify(during.groups)}`)
  expect(agentTab !== undefined, `the agent has no tab in its group: ${JSON.stringify(during.tabs)}`)
  expect(agentTab?.id !== userTabId, "the agent's tab is the user's tab")
  expect(
    refused.includes("not in the agent session"),
    `selecting the user's tab was not refused:\n${refused.slice(0, 500)}`,
  )
  return {
    agentTab: agentTab?.id,
    group: kiloGroup,
    hubLog: result.hub.log.text.slice(-1_500),
    listed: (listed ?? "").slice(0, 800),
    refused: refused.slice(0, 400),
    tabs: during.tabs.map((tab) => ({ active: tab.active, groupId: tab.groupId, id: tab.id, url: tab.url })),
    userTabId,
  }
}

async function stop() {
  let stopError: unknown
  let liveGroupId: number | undefined
  let endedGroup: GroupInfo | undefined
  const stopAll = async () => {
    try {
      const live = await until(
        async () => (await tabState()).groups.find((group) => typeof group.title === "string" && group.title.startsWith("Kilo · ")),
        20_000,
        "the live Kilo group",
      )
      liveGroupId = live.id
      const button = panel.getByRole("button", { name: "Stop all" })
      await button.waitFor({ timeout: 20_000 })
      await button.click()
      endedGroup = await until(async () => {
        if (liveGroupId === undefined) return undefined
        const group = groupOf(await worker.evaluate(async (id: number) => chrome.tabGroups.get(id), liveGroupId))
        return group.title === "Kilo · ended" && group.collapsed === true && group.color === "grey" ? group : undefined
      }, 20_000, "the group turns ended")
    } catch (error) {
      stopError = error
    }
  }

  const result = await run(
    (step) => {
      if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
      if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
      if (step.results.length === 2) {
        // Stop all while the CLI waits for the model's next step; the next call is the one after the stop.
        return (async () => {
          await stopAll()
          const afterStop: Call = { args: { url: `${localOrigin}/?after-stop=1` }, name: "browser_navigate" }
          return afterStop
        })()
      }
      return undefined
    },
    {},
  )

  const next = result.last.results[2] ?? ""
  const state = await tabState()
  expect(stopError === undefined, `Stop all did not run: ${String(stopError)}`)
  expect(endedGroup !== undefined, `no "Kilo · ended" group: ${JSON.stringify(state.groups)}`)
  expect(next.includes("The user stopped this browser session"), `the next call was not user_stopped:\n${next.slice(0, 600)}`)
  return {
    ended: endedGroup,
    groups: state.groups,
    hubLog: result.hub.log.text.slice(-1_500),
    liveGroupId,
    next: next.slice(0, 600),
  }
}

async function unpaired() {
  // The extension is loaded but its switch is off: nothing dials the hub the CLI finds for itself.
  const result = await run(
    (step) => (step.results.length === 0 ? { args: { url: localOrigin }, name: "browser_navigate" } : undefined),
    {},
    { pair: false },
  )
  const reply = result.last.results[0] ?? ""
  const output = `${result.stdout}\n${result.stderr}`
  const hint = "Install the Kilo browser extension and turn on"
  expect(reply.includes("The browser is not available right now"), `the CLI did not get browser_unavailable:\n${reply.slice(0, 500)}`)
  // #16305 puts the setup step into the model-visible text, not only the tool metadata (a non-interactive run has no toast).
  expect(reply.includes(hint), `the setup step is not model-visible:\n${reply.slice(0, 800)}`)
  expect(output.includes(hint), `the setup step is missing from the CLI output:\n${output.slice(-2_000)}`)
  return {
    hubLog: result.hub.log.text.slice(-1_500),
    reply: reply.slice(0, 400),
    run: { code: result.code, stderr: result.stderr.slice(-1_500) },
  }
}

let downloadsPath: string | undefined

async function downloadFiles(): Promise<string[]> {
  if (downloadsPath === undefined) return []
  return (await fs.readdir(downloadsPath).catch(() => [] as string[])).filter((file) => !file.endsWith(".crdownload"))
}

async function downloadBodies(): Promise<string[]> {
  const directory = downloadsPath
  if (directory === undefined) return []
  return Promise.all((await downloadFiles()).map((file) => fs.readFile(path.join(directory, file), "utf8").catch(() => "")))
}

async function clearDownloads() {
  const directory = downloadsPath
  if (directory === undefined) return
  for (const file of await fs.readdir(directory).catch(() => [] as string[])) {
    await fs.rm(path.join(directory, file), { force: true, recursive: true }).catch(() => undefined)
  }
}

const APPROVAL = "Approved. Repeat the same step"
const APPROVAL_LATE = "Approved. Repeat that step"

/**
 * A click on an attachment link: the first call cancels the download and reports a post-action need (auto-approved by
 * `allow_sensitive`), the identical repeat spends the step token and keeps exactly one file, and a third identical call
 * is guarded again. The folder is read after every call, not polled.
 */
async function download() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-page` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length >= 2 && step.results.length <= 4) {
      // The repeat's file is written asynchronously; let it land before the third call arms the guard again.
      if (step.results.length === 4) await until(async () => ((await downloadFiles()).length === 1 ? true : undefined), 10_000, "the repeat's file lands")
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  // The guarded call is event index 2 (navigate, snapshot, click); the repeat must follow it in under 200 ms.
  const events = toolTimes(result.stdout)
  const repeatGapMs = events[3] === undefined || events[2] === undefined ? undefined : Math.round(events[3].start - events[2].end)
  expect(repeatGapMs !== undefined && repeatGapMs < 200, `the repeat was not immediate: ${String(repeatGapMs)} ms`)
  expect(text[2]?.includes(APPROVAL), `the guarded click did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 0, `the stopped download created a file: ${JSON.stringify(folder[3])}`)
  expect(!(text[3] ?? "").includes("permission"), `the repeat was refused:\n${(text[3] ?? "").slice(0, 600)}`)
  expect((folder[4] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[4])}`)
  expect(text[4]?.includes(APPROVAL), `the third call was not guarded again:\n${(text[4] ?? "").slice(0, 600)}`)
  expect((folder[5] ?? []).length === 1, `the third call changed the folder: ${JSON.stringify(folder[5])}`)
  expect(hits === 3, `the click reached the fixture ${hits} times instead of three`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    folder,
    hits,
    repeatGapMs,
    results: text.map((value) => value.slice(0, 400)),
    texts: text.slice(2, 5).map((value) => value.slice(0, 300)),
  }
}

/** Navigating straight to an attachment URL: the same guarded, approved-repeat and re-guarded sequence. */
async function downloadNavigate() {
  const userUrl = `${localOrigin}/user`
  const userTabId = await openUserTab(userUrl)
  const userBefore = (await tabState()).tabs.find((tab) => tab.id === userTabId)
  let during: Awaited<ReturnType<typeof tabState>> | undefined
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 2) during = await tabState()
    if (step.results.length <= 2) return { args: { url: `${localOrigin}/download` }, name: "browser_navigate" }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  const after = await tabState()
  const userDuring = during?.tabs.find((tab) => tab.id === userTabId)
  const userAfter = after.tabs.find((tab) => tab.id === userTabId)
  expect(text[0]?.includes(APPROVAL), `the guarded navigation did not report the approval:\n${(text[0] ?? "").slice(0, 600)}`)
  expect((folder[1] ?? []).length === 0, `the guarded navigation created a file: ${JSON.stringify(folder[1])}`)
  expect(
    (text[1] ?? "").includes("The file was downloaded; the page did not change."),
    `the kept navigation did not report the file:\n${(text[1] ?? "").slice(0, 600)}`,
  )
  expect((folder[2] ?? []).length === 1, `the repeat navigation did not save exactly one file: ${JSON.stringify(folder[2])}`)
  expect(text[2]?.includes(APPROVAL), `the third navigation was not guarded again:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 1, `the third navigation changed the folder: ${JSON.stringify(folder[3])}`)
  expect(hits === 3, `the navigation reached the fixture ${hits} times instead of three`)
  expect(userBefore?.groupId === -1, `the user tab was already grouped: ${JSON.stringify(userBefore)}`)
  expect(userDuring?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userDuring)}`)
  expect(userAfter?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userAfter)}`)
  expect(userAfter?.url === userUrl, `the user tab was navigated: ${JSON.stringify(userAfter)}`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    folder,
    hits,
    texts: text.slice(0, 3).map((value) => value.slice(0, 400)),
    userTabId,
    userTab: userAfter,
  }
}

/** `browser_tabs new <attachment>`: guarded, then the approved repeat keeps one file on the same tab, no second tab. */
async function downloadTabsNew() {
  const url = `${localOrigin}/download`
  const folder: string[][] = []
  let afterFirst: Awaited<ReturnType<typeof tabState>> | undefined
  let afterRepeat: Awaited<ReturnType<typeof tabState>> | undefined
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 1) afterFirst = await tabState()
    if (step.results.length === 2) afterRepeat = await tabState()
    if (step.results.length <= 1) return { args: { action: "new", url }, name: "browser_tabs" }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  // The agent's tab is the one in its Kilo group.
  const agentTabs = (state: Awaited<ReturnType<typeof tabState>> | undefined) =>
    (state?.tabs ?? [])
      .filter((tab) => tab.groupId !== -1)
      .map((tab) => tab.id)
      .sort()
  expect(text[0]?.includes(APPROVAL), `the guarded tabs-new did not report the approval:\n${(text[0] ?? "").slice(0, 600)}`)
  expect((folder[1] ?? []).length === 0, `the guarded tabs-new created a file: ${JSON.stringify(folder[1])}`)
  expect(
    (text[1] ?? "").includes("The file was downloaded; the page did not change."),
    `the repeat did not report the kept file:\n${(text[1] ?? "").slice(0, 600)}`,
  )
  expect((folder[2] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[2])}`)
  expect(
    JSON.stringify(agentTabs(afterFirst)) === JSON.stringify(agentTabs(afterRepeat)),
    `a second tab appeared: ${JSON.stringify(afterFirst?.tabs)} -> ${JSON.stringify(afterRepeat?.tabs)}`,
  )
  expect(agentTabs(afterRepeat).length === 1, `the agent has ${agentTabs(afterRepeat).length} tabs`)
  expect(hits === 2, `the attachment was requested ${hits} times instead of two`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    agentTabs: agentTabs(afterRepeat),
    folder,
    hits,
    texts: text.slice(0, 2).map((value) => value.slice(0, 400)),
  }
}

/**
 * A tabs-new on a session that already has a tab, with no token: the guarded call must refuse and the folder must stay
 * empty — no later file either, since nothing repeats the step. A silent keep here is a download the user never approved.
 */
async function downloadTabsNewNoToken() {
  const url = `${localOrigin}/download`
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    const index = step.results.length
    if (index === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index === 2) return { args: { action: "new", url }, name: "browser_tabs" }
    if (index === 3) {
      folder[3] = await downloadFiles()
      await Bun.sleep(5000)
      folder[4] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const saved = await downloadFiles()
  expect(
    (text[2] ?? "").includes(APPROVAL),
    `the guarded tabs-new did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`,
  )
  expect((folder[3] ?? []).length === 0, `the unapproved tabs-new created a file at once: ${JSON.stringify(folder[3])}`)
  expect(saved.length === 0, `the unapproved tabs-new created a file: ${JSON.stringify(saved)}`)
  return { folder, saved, texts: (text[2] ?? "").slice(0, 400) }
}

/**
 * The approved retry's page also starts a second, different download. Exactly one file is kept — the approved step's
 * own — and the second is stopped and reported, not silently saved.
 */
async function downloadApprovedOne() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-two` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2 || step.results.length === 3) {
      // The approved file is written asynchronously; let it land before the next call reads the folder.
      if (step.results.length === 3) await until(async () => ((await downloadFiles()).length === 1 ? true : undefined), 10_000, "the approved file lands")
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 4) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 5) {
      // A stopped download must not surface a file later either.
      await Bun.sleep(2500)
      folder[5] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsOf = (pathname: string) => downloadHits.filter((hit) => hit.path === pathname).length
  const approvedBefore = hitsOf("/download")
  const secondBefore = hitsOf("/download-second")
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = { approved: hitsOf("/download") - approvedBefore, second: hitsOf("/download-second") - secondBefore }
  const saved = await downloadFiles()
  const bodies = await downloadBodies()
  const reported = [text[3], text[4], text[5]].map((value) => value ?? "").join("\n")
  expect(text[2]?.includes(APPROVAL), `the guarded click did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 0, `the guarded click saved a file: ${JSON.stringify(folder[3])}`)
  expect((folder[4] ?? []).length === 1, `the approved repeat did not keep exactly one file: ${JSON.stringify(folder[4])}`)
  expect((folder[5] ?? []).length === 1, `the folder changed after the approved repeat: ${JSON.stringify(folder[5])}`)
  expect(saved.length === 1, `the folder holds ${saved.length} files: ${JSON.stringify(saved)}`)
  expect(bodies.some((body) => body.includes("report-body")), `the approved file was not kept: ${JSON.stringify(bodies)}`)
  expect(!bodies.some((body) => body.includes("second-body")), `the second download was kept: ${JSON.stringify(bodies)}`)
  expect(reported.includes("second.txt"), `the second download was not reported:\n${reported.slice(0, 800)}`)
  expect(reported.includes("permission"), `the second download was not refused:\n${reported.slice(0, 800)}`)
  expect(hits.approved === 2, `the approved route was hit ${hits.approved} times instead of two`)
  expect(hits.second === 2, `the second route was hit ${hits.second} times instead of two`)
  return {
    bodies,
    folder,
    hits,
    saved,
    texts: [text[2], text[3], text[4], text[5]].map((value) => (value ?? "").slice(0, 400)),
  }
}

/** A click whose download starts about 500 ms later: the next call reports it, and the repeat keeps one file. */
async function downloadLate() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    const i = step.results.length
    if (i === 0) return { args: { url: `${localOrigin}/download-late-page` }, name: "browser_navigate" }
    if (i === 1) return { args: {}, name: "browser_snapshot" }
    if (i === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 3) {
      // The attachment arrives ~1.5 s after the click; the very next call (a snapshot) reports it.
      await Bun.sleep(2400)
      return { args: {}, name: "browser_snapshot" }
    }
    if (i === 4) {
      // The repeat of the step named by the need spends the token and keeps the file.
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 5) {
      // The repeat's attachment is delayed by 1.5 s; then a third identical click without a token is guarded.
      await until(async () => ((await downloadFiles()).length === 1 ? true : undefined), 10_000, "the kept late file lands")
      folder[5] = await downloadFiles()
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 6) {
      // The third click's own late download is stopped by its linger; the folder must not grow.
      await Bun.sleep(2200)
      folder[6] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  expect((folder[3] ?? []).length === 0, `the click started a download at once: ${JSON.stringify(folder[3])}`)
  expect(!(text[2] ?? "").includes(APPROVAL), `the click itself caught the late download, not the next call:\n${(text[2] ?? "").slice(0, 400)}`)
  expect(
    (text[3] ?? "").includes("started a download of report.txt") && (text[3] ?? "").includes("Repeat that step"),
    `the next call did not report the late download with its file:\n${(text[3] ?? "").slice(0, 600)}`,
  )
  expect(!(text[4] ?? "").includes("permission"), `the repeated click was refused:\n${(text[4] ?? "").slice(0, 600)}`)
  expect((folder[5] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[5])}`)
  expect(!(text[5] ?? "").includes("Approval"), `the third click asked for approval instead of being guarded:\n${(text[5] ?? "").slice(0, 600)}`)
  expect((folder[6] ?? []).length === 1, `the third click kept a new file: ${JSON.stringify(folder[6])}`)
  expect(hits === 3, `the late route served ${hits} times instead of three`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return { code: result.code, folder, hits, texts: [text[2], text[3], text[4], text[5]].map((value) => (value ?? "").slice(0, 400)) }
}

/** The shipped build (downloads not granted): a download-capable call is refused with the re-grant text, no file. */
async function downloadUngranted() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-page` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  // Every download-capable tool is fail-closed without the permission; navigation itself is one, so the first call
  // may be the refused one and the click is never reached.
  const refused = [text[0], text[2]].find((value) => (value ?? "").includes("optional Downloads permission is not granted")) ?? text[2] ?? ""
  const files = await downloadFiles()
  expect(refused.includes("optional Downloads permission is not granted"), `no call was refused for the permission:\n${JSON.stringify(text.map((value) => value.slice(0, 200)))}`)
  expect(refused.includes("blocked"), `the refusal is not the blocked state:\n${refused.slice(0, 600)}`)
  expect(files.length === 0, `a file appeared without the permission: ${JSON.stringify(files)}`)
  expect(downloadHits.length - hitsBefore === 0, `a download-capable call reached the fixture without the permission`)
  return { calls: text.map((value) => value.slice(0, 200)), files, hits: downloadHits.length - hitsBefore, refused: refused.slice(0, 500) }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

let base = ""
const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  download,
  "download-navigate": downloadNavigate,
  "download-ungranted": downloadUngranted,
  "download-late": downloadLate,
  "download-tabs-new": downloadTabsNew,
  "download-tabs-new-notoken": downloadTabsNewNoToken,
  "download-approved-one": downloadApprovedOne,
  frames,
  group,
  "navigate-snapshot": navigateSnapshot,
  permission,
  sensitive,
  stop,
  unpaired,
}

const selected = scenarios[scenario]
if (!selected) throw new Error(`unknown scenario ${scenario}; choose ${Object.keys(scenarios).join(", ")}`)

base = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "bridge-e2e-")))
if (process.env.E2E_HOME) await fs.mkdir(base, { recursive: true })

// The downloads scenarios load the promoted copy (the accepted-permission state); the ungranted one loads the
// shipped build, where `downloads` stays optional and unrequested.
// Every scenario runs against the accepted-permission state except the explicit "not granted" one.
const promoted = scenario !== "download-ungranted"
const usesDownloads = promoted
const extension = promoted ? await promoteDownloadsCopy(extensionDirectory, path.join(base, "extension-downloads")) : extensionDirectory
if (usesDownloads) {
  downloadsPath = path.join(base, "downloads")
  await fs.mkdir(downloadsPath, { recursive: true })
}

try {
  await launch(base, { extension, ...(downloadsPath === undefined ? {} : { downloads: downloadsPath }) })
  if (scenario === "unpaired") {
    panel = await context.newPage()
  } else {
    await enableLocalAgents(base)
  }
  const results = await selected()
  console.log(JSON.stringify(report(results), null, 2))
  if (failures.length) process.exitCode = 1
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  console.log(JSON.stringify(report({}), null, 2))
  process.exitCode = 1
} finally {
  swLog?.stop()
  await context?.close().catch(() => undefined)
  fixture.stop(true)
  frame.stop(true)
  model.stop(true)
}
