#!/usr/bin/env bun
// Real end-to-end check of the Kilo browser bridge: the built Chrome MV3 extension loaded into Chromium, paired over
// loopback with the real CLI (`kilo2 run`, `browser.backend: "extension"`), driven by a scripted OpenAI-compatible
// model. Not a `bun test` file: it needs a display (run it under xvfb), a built CLI binary and the built extension.
//
//   bun test/browser/extension-e2e.ts <kilo2> <scenario>
//
//   E2E_EXTENSION_DIR   the built unpacked extension (default: <cloud>/apps/extension/.output/chrome-mv3)
//   E2E_CHROMIUM        the Chromium executable (default: playwright-core's own build)
//   E2E_HOME            the run's home (default: a fresh mkdtemp); the harness creates run-<n> under it
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

const binary = process.argv[2]
const scenario = process.argv[3] ?? "navigate-snapshot"
if (!binary) throw new Error("usage: bun test/browser/extension-e2e.ts <kilo2> <scenario>")

/** playwright-core belongs to the plugin workspace; resolve it from there so hoisting does not matter. */
const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright: any = await import(Bun.resolveSync("playwright-core", pluginDirectory))
const chromium = playwright.chromium

const extensionDirectory =
  process.env.E2E_EXTENSION_DIR ?? path.resolve(import.meta.dirname, "../../../../cloud/apps/extension/.output/chrome-mv3")
const executablePath = process.env.E2E_CHROMIUM ?? chromium.executablePath()
const downloadsDirectory = process.env.E2E_DOWNLOADS ?? path.join(os.homedir(), "Downloads")

const MARKER = "IFRAME-MARKER"
const PUBLIC_MARKER = "PUBLIC-ORIGIN"
const PASSWORD_VALUE = "hunter2"

// ---------------------------------------------------------------------------------------------
// Fixtures: a localhost page, a cross-origin frame on 127.0.0.2, and a download.
// ---------------------------------------------------------------------------------------------

/** Every value the fixture page reported from its password field. */
const recorded: string[] = []
/** Every download request the fixture served, so a stopped download is distinguishable from a click that never ran. */
const downloadHits: { at: number }[] = []

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
</body></html>`

const userPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>User tab</title></head>
<body><h1>USER PAGE</h1></body></html>`

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
      downloadHits.push({ at: Date.now() })
      return new Response("report-body", {
        headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="report.txt"' },
      })
    }
    if (url.pathname === "/user") return new Response(userPage, { headers: { "content-type": "text/html; charset=utf-8" } })
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
type Reply = { result: string; image?: Png.Image }

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return (value as Record<string, unknown>)[key]
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
    return [{ name, args }]
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
  if (typeof value !== "object" || value === null) return undefined
  for (const key of ["uri", "url", "data", "image_url", "source"]) {
    const found = pngOf((value as Record<string, unknown>)[key], depth + 1)
    if (found) return found
  }
  return undefined
}

function read(messages: unknown): Step {
  const calls: Call[] = []
  const results: string[] = []
  const images: string[] = []
  if (!Array.isArray(messages)) return { calls, results, images }
  for (const message of messages) {
    const role = field(message, "role")
    if (role === "assistant") calls.push(...callsOf(field(message, "tool_calls")))
    if (role !== "tool") continue
    const content = field(message, "content")
    results.push(textOf(content))
    const png = pngOf(content)
    if (png) images.push(png)
  }
  return { calls, results, images }
}

const chunk = (model: string, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

const toolCall = (model: string, name: string, args: unknown) =>
  [
    chunk(
      model,
      {
        role: "assistant",
        tool_calls: [
          { index: 0, id: `call_${name}_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      null,
    ),
    chunk(model, {}, "tool_calls"),
    `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")

const answer = (model: string, text: string) =>
  [
    chunk(model, { role: "assistant", content: text }, null),
    chunk(model, {}, "stop"),
    `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
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
    if (!tools.some((tool) => tool.startsWith("browser_"))) return sse(answer(name, "Browser E2E"))

    const step = read(field(body, "messages"))
    history.push(step)
    const next = activePlan === undefined ? undefined : await activePlan(step)
    if (next === undefined) return sse(answer(name, "Browser E2E finished"))
    return sse(toolCall(name, next.name, next.args))
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
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Extension service-worker console and exceptions, through the browser-level CDP session. */
class ServiceWorkerLog {
  readonly lines: string[] = []
  private attached = new Map<string, string>()
  private nextId = 1

  constructor(private readonly browser: any) {}

  async start() {
    try {
      const session = await this.browser.newBrowserCDPSession()
      this.session = session
      session.on("Target.receivedMessageFromTarget", (event: any) => this.receive(event))
      session.on("Target.detachedFromTarget", (event: any) => this.attached.delete(event.sessionId))
      await session.send("Target.setDiscoverTargets", { discover: true })
      session.on("Target.targetCreated", (event: any) => {
        if (this.mine(event.targetInfo)) void this.attach(event.targetInfo.targetId)
      })
      await this.attachAll()
      this.timer = setInterval(() => void this.attachAll(), 2_000)
      return true
    } catch (error) {
      this.lines.push(`[relay] cannot attach to the browser's CDP session: ${String(error)}`)
      return false
    }
  }

  private session: any
  private timer: ReturnType<typeof setInterval> | undefined

  private mine(info: any) {
    return info?.type === "service_worker" && typeof info.url === "string" && info.url.includes(extensionId)
  }

  private async attachAll() {
    if (!this.session) return
    try {
      const { targetInfos } = await this.session.send("Target.getTargets")
      for (const info of targetInfos ?? []) if (this.mine(info)) await this.attach(info.targetId)
    } catch (error) {
      this.lines.push(`[relay] cannot list targets: ${String(error)}`)
    }
  }

  private async attach(targetId: string) {
    if (!this.session || this.attached.has(targetId)) return
    try {
      const { sessionId } = await this.session.send("Target.attachToTarget", { targetId, flatten: false })
      this.attached.set(targetId, sessionId)
      await this.send(sessionId, "Runtime.enable")
    } catch (error) {
      this.lines.push(`[relay] cannot attach to ${targetId}: ${String(error)}`)
    }
  }

  private async send(sessionId: string, method: string, params: object = {}) {
    await this.session.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id: this.nextId++, method, params }),
    })
  }

  private receive(event: any) {
    let message: any
    try {
      message = JSON.parse(event.message)
    } catch {
      return
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const args = (message.params?.args ?? []).map((arg: any) => arg.value ?? arg.description ?? arg.type)
      this.push(`[${message.params?.type ?? "log"}] ${args.join(" ")}`)
    }
    if (message.method === "Runtime.exceptionThrown") {
      this.push(`[exception] ${message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text}`)
    }
  }

  private push(line: string) {
    this.lines.push(line.slice(0, 2_000))
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

let extensionId = ""
let context: any
let panel: any
let worker: any
let swLog: ServiceWorkerLog | undefined

async function launch(base: string) {
  await fs.access(path.join(extensionDirectory, "manifest.json"))
  if (!existsSync(executablePath)) throw new Error(`no Chromium at ${executablePath}; run playwright-core's install or set E2E_CHROMIUM`)
  context = await chromium.launchPersistentContext(path.join(base, "profile"), {
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath,
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1280, height: 900 },
  })
  context.setDefaultTimeout(20_000)
  const existing = context.serviceWorkers()[0]
  worker = existing ?? (await context.waitForEvent("serviceworker"))
  extensionId = new URL(worker.url()).host
  swLog = new ServiceWorkerLog(context.browser())
  await swLog.start()
  return { extensionId }
}

/** Turns on "Allow local agents" through the extension's own settings page, as a signed-in user would. */
async function enableLocalAgents(base: string) {
  // Auth validation and organization fetches: the settings header only exists for a signed-in session.
  await context.route("https://app.kilo.ai/api/user", (route: any) =>
    route.fulfill({ json: { google_user_email: "e2e@kilo.ai" }, status: 200 }),
  )
  await context.route("https://app.kilo.ai/api/organizations", (route: any) =>
    route.fulfill({ json: { organizations: [] }, status: 200 }),
  )
  await context.route(
    (url: URL) => url.origin === "https://app.kilo.ai" && url.pathname.startsWith("/api/trpc/"),
    (route: any) => route.fulfill({ json: {}, status: 200 }),
  )
  // A real user answers the optional-permission prompt; automation cannot. The page grants it the way an accepted
  // prompt would, keeping the flow deterministic (loopback pairing does not need the permission).
  await context.addInitScript({
    content:
      "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
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
  expect(
    (stored as any)?.kiloLocalAgentSettings?.enabled === true,
    `the switch did not persist: ${JSON.stringify(stored)}`,
  )
}

async function seedAuth() {
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const api = (globalThis as any).chrome
        api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "e2e@kilo.ai" } }, () => {
          const message = api.runtime?.lastError?.message
          if (message) reject(new Error(message))
          else resolve()
        })
      }),
  )
}

/** A tab the user opened before the run: no opener, so no session may ever claim it. */
async function openUserTab(url: string): Promise<number> {
  const cdp = await context.newCDPSession(panel)
  await cdp.send("Target.createTarget", { url, newWindow: false })
  return await until(async () => {
    const tabs: any[] = await worker.evaluate(() => chrome.tabs.query({}))
    const tab = tabs.find((candidate) => candidate.url === url)
    return tab?.id as number | undefined
  }, 10_000, "the user tab appears")
}

async function tabState() {
  const tabs: any[] = await worker.evaluate(() => chrome.tabs.query({}))
  const groups: any[] = await worker.evaluate(() => chrome.tabGroups.query({}))
  return { groups, tabs }
}

// ---------------------------------------------------------------------------------------------
// Hub: start `kilo2 browser hub --loopback`, ask it for a pairing URL over its CLI socket, open that page.
// ---------------------------------------------------------------------------------------------

type Hub = {
  child: any
  port: number
  log: { text: string }
  entry: () => Promise<any>
  stop: () => Promise<void>
}

function environment(root: string, settings: Settings) {
  const run = path.join(root, "run")
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: run,
    KILO_BROWSER_RUN_DIR: path.join(run, "browser"),
    KILO_BROWSER_DATA_DIR: path.join(root, "data", "kilo2", "browser"),
    KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
    KILO_CONFIG_CONTENT: JSON.stringify(config(settings)),
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_AUTH_CONTENT: "",
    KILO_API_KEY: "",
    PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}`,
    NO_PROXY: "127.0.0.1,127.0.0.2,localhost",
    no_proxy: "127.0.0.1,127.0.0.2,localhost",
  }
}

async function prepareHome(root: string) {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(path.join(root, "bin"), { recursive: true })
  await fs.mkdir(path.join(root, "run"), { recursive: true, mode: 0o700 })
  // The CLI's system opener is xdg-open on Linux; a no-op keeps an unpaired run from waiting on it.
  const opener = path.join(root, "bin", "xdg-open")
  await fs.writeFile(opener, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
}

async function readHubEntry(root: string) {
  const directory = path.join(root, "run", "browser", "hubs")
  const files = await fs.readdir(directory).catch(() => [] as string[])
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      return JSON.parse(await fs.readFile(path.join(directory, file), "utf8"))
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
    stdout: "pipe",
    stderr: "pipe",
  })
  tap(child.stdout as ReadableStream<Uint8Array>, log)
  tap(child.stderr as ReadableStream<Uint8Array>, log)
  const entry = await until(async () => readHubEntry(root), 30_000, "the hub registers itself")
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
async function hubRequest(socketPath: string, method: string, params: unknown): Promise<any> {
  const socket = net.createConnection(socketPath)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  return await new Promise((resolve, reject) => {
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
        let frame: any
        try {
          frame = JSON.parse(text)
        } catch {
          continue
        }
        if (frame?.type !== "rpc" || frame.message?.id !== 1) continue
        clearTimeout(timer)
        socket.end()
        if (frame.message.error) reject(new Error(frame.message.error.message))
        else resolve(frame.message.result)
        return
      }
    })
    socket.once("error", (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    const body = Buffer.from(JSON.stringify({ type: "rpc", message: { jsonrpc: "2.0", id: 1, method, params } }))
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length, 0)
    socket.write(Buffer.concat([header, body]))
  })
}

/** The CLI's pairing step: ask the hub for its one-time URL and open the page in this browser. */
async function pair(hub: Hub) {
  const answer = await hubRequest(hub.entry().then ? (await hub.entry()).socket : (await hub.entry()).socket, "pairing.url", {})
  const cdp = await context.newCDPSession(panel)
  // A tab with no opener: the extension observes the navigation and closes it after redeeming the token.
  await cdp.send("Target.createTarget", { url: answer.url, newWindow: true })
  await until(async () => {
    const entry = await hub.entry()
    return entry?.paired === true ? entry : undefined
  }, 30_000, "the extension pairs and connects")
  return answer.url
}

// ---------------------------------------------------------------------------------------------
// CLI runs: a fresh home, a fresh hub, the scripted model, and `kilo2 run`.
// ---------------------------------------------------------------------------------------------

type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Settings = { allowSensitive?: boolean; rules?: Rule[]; auto?: boolean }

function config(settings: Settings) {
  return {
    model: "local/echo",
    providers: {
      local: {
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${model.url.origin}/v1`, apiKey: "local-key" },
        models: { echo: { name: "Echo", limit: { context: 200_000, output: 4_000 } } },
      },
    },
    browser: {
      backend: "extension",
      observation: "full",
      ...(settings.allowSensitive ? { allow_sensitive: true } : {}),
    },
    ...(settings.rules?.length ? { permissions: settings.rules } : {}),
  }
}

let runCounter = 0

type Run = {
  root: string
  hub: Hub
  stdout: string
  stderr: string
  code: number
  steps: Step[]
  last: Step
}

async function run(plan: Plan, settings: Settings, hooks: { stop?: () => Promise<void> } = {}): Promise<Run> {
  runCounter += 1
  const root = path.join(base, `run-${runCounter}`)
  await prepareHome(root)
  const hub = await startHub(root, settings)
  try {
    await pair(hub)
    history.length = 0
    activePlan = plan
    const child = Bun.spawn(
      [binary, "run", "Check the browser bridge.", "--model", "local/echo", "--standalone", "--format", "json", ...(settings.auto ? ["--auto"] : [])],
      {
        cwd: root,
        env: environment(root, settings),
        stdout: "pipe",
        stderr: "pipe",
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
    const last = steps.at(-1) ?? { calls: [], results: [], images: [] }
    return { code, hub, last, root, stderr, steps, stdout }
  } finally {
    await hub.stop()
  }
}

function text(reply: Reply | undefined) {
  return reply?.result ?? ""
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
function jsonOf(text: string): any {
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

function report(results: Record<string, unknown>) {
  return {
    scenario,
    extensionId,
    chromium: executablePath,
    extension: extensionDirectory,
    ...results,
    failures,
    serviceWorker: swLog?.lines.slice(-120) ?? [],
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

async function navigateSnapshot() {
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: localOrigin } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      return ref ? { name: "browser_click", args: { element: "the Click me button", target: ref } } : undefined
    }
    if (step.results.length === 3) return { name: "browser_snapshot", args: {} }
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
    run: { code: result.code, stderr: result.stderr.slice(-2_000) },
  }
}

async function permission() {
  // 127.0.0.2 is not the localhost family, so the default rules ask for it.
  const refused = await run((step) =>
    step.results.length === 0 ? { name: "browser_navigate", args: { url: `${publicOrigin}/public` } } : undefined,
  {}, {})
  const refusedResult = refused.last.results[0] ?? ""
  expect(
    refusedResult.includes("cannot ask the user for permission") || refusedResult.includes("Permission denied"),
    `a non-localhost navigation was not refused:\n${refusedResult.slice(0, 500)}`,
  )
  expect(!refusedResult.includes(PUBLIC_MARKER), `the refused navigation leaked the page:\n${refusedResult.slice(0, 500)}`)

  const rules: Rule[] = [
    { action: "browser", resource: `navigate:${publicOrigin}`, effect: "allow" },
    { action: "browser", resource: `read:${publicOrigin}`, effect: "allow" },
  ]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: `${publicOrigin}/public` } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    return undefined
  }, { rules })
  const navigated = allowed.last.results[0] ?? ""
  const snapshot = allowed.last.results[1] ?? ""
  expect(navigated.includes(`- Page URL: ${publicOrigin}`), `the allowed navigation did not report the URL:\n${navigated.slice(0, 500)}`)
  expect(snapshot.includes(PUBLIC_MARKER), `the granted page's content is missing:\n${snapshot.slice(0, 500)}`)
  return {
    allowed: { snapshot: snapshot.slice(0, 500), stdout: allowed.stdout.slice(-1_000) },
    hubLogs: [refused.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    refused: refusedResult.slice(0, 500),
  }
}

async function frames() {
  const withheld = await run((step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: `${localOrigin}/framed` } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) return { name: "browser_take_screenshot", args: { type: "png" } }
    return undefined
  }, {})
  const snapshot = withheld.last.results[1] ?? ""
  const masked = decodePng(withheld.last.images[0])
  const maskedPixel = pixel(masked, 8, 8)
  expect(
    snapshot.includes(`[origin withheld: ${publicOrigin}]`),
    `the snapshot did not withhold the frame:\n${snapshot.slice(0, 600)}`,
  )
  expect(!snapshot.includes(MARKER), `the withheld frame's marker reached the snapshot:\n${snapshot.slice(0, 600)}`)
  expect(
    maskedPixel !== undefined && maskedPixel[0] < 40 && maskedPixel[1] < 40 && maskedPixel[2] < 40,
    `the screenshot is not masked: ${JSON.stringify(maskedPixel)}`,
  )

  const rules: Rule[] = [{ action: "browser", resource: `read:${publicOrigin}`, effect: "allow" }]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: `${localOrigin}/framed` } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) return { name: "browser_snapshot", args: { target: "iframe" } }
    if (step.results.length === 3) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 4) return { name: "browser_take_screenshot", args: { type: "png" } }
    return undefined
  }, { rules })
  const granted = allowed.last.results[3] ?? ""
  const revealed = decodePng(allowed.last.images[0])
  const revealedPixel = pixel(revealed, 8, 8)
  expect(granted.includes(MARKER), `the granted frame's marker is missing:\n${granted.slice(0, 600)}`)
  expect(
    revealedPixel !== undefined && revealedPixel[0] > 200 && revealedPixel[1] < 80 && revealedPixel[2] < 80,
    `the granted frame is not visible in the screenshot: ${JSON.stringify(revealedPixel)}`,
  )
  return {
    granted: granted.slice(0, 600),
    hubLogs: [withheld.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    maskedPixel,
    snapshot: snapshot.slice(0, 600),
    revealedPixel,
  }
}

async function sensitive() {
  recorded.length = 0
  const basePlan: Plan = (step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: localOrigin } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      // The click establishes the act grant, so the type's own call is where the sensitive step is classified.
      return ref ? { name: "browser_click", args: { element: "the Click me button", target: ref } } : undefined
    }
    if (step.results.length === 3) {
      const ref = refOf(step.results[1] ?? "", /textbox "Password" \[ref=([^\]]+)\]/)
      return ref ? { name: "browser_type", args: { element: "the password field", target: ref, text: PASSWORD_VALUE } } : undefined
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
  const before = await tabState()
  const userBefore = before.tabs.find((tab) => tab.id === userTabId)

  const result = await run((step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: localOrigin } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) return { name: "browser_tabs", args: { action: "list" } }
    if (step.results.length === 3) {
      const listed = jsonOf(step.results[2] ?? "")
      const withheld = listed?.tabs?.find((tab: any) => tab.url === "[origin withheld]")
      return withheld ? { name: "browser_tabs", args: { action: "select", index: withheld.index } } : undefined
    }
    return undefined
  }, {})

  const after = await tabState()
  const userAfter = after.tabs.find((tab) => tab.id === userTabId)
  const kiloGroup = after.groups.find((candidate) => typeof candidate.title === "string" && candidate.title.startsWith("Kilo · "))
  const agentTab = after.tabs.find((tab) => kiloGroup !== undefined && tab.groupId === kiloGroup.id)
  const refused = result.last.results[3] ?? ""

  expect(userBefore?.groupId === -1, `the user tab was already grouped: ${JSON.stringify(userBefore)}`)
  expect(userAfter !== undefined, "the user tab disappeared")
  expect(userAfter?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userAfter)}`)
  expect(userAfter?.url === userUrl, `the user tab was navigated: ${JSON.stringify(userAfter)}`)
  expect(kiloGroup !== undefined, `no "Kilo · …" tab group: ${JSON.stringify(after.groups)}`)
  expect(agentTab !== undefined, `the agent has no tab in its group: ${JSON.stringify(after.tabs)}`)
  expect(agentTab?.id !== userTabId, "the agent's tab is the user's tab")
  expect(
    refused.includes("not in the agent session") || refused.includes("not in the agent session’s tab group"),
    `selecting the user's tab was not refused:\n${refused.slice(0, 500)}`,
  )
  return {
    agentTab: agentTab?.id,
    group: kiloGroup,
    hubLog: result.hub.log.text.slice(-1_500),
    refused: refused.slice(0, 400),
    tabs: after.tabs.map((tab) => ({ active: tab.active, groupId: tab.groupId, id: tab.id, url: tab.url })),
    userTabId,
  }
}

async function stop() {
  let stoppedGroupId: number | undefined
  let stopError: unknown
  const stopAll = async () => {
    try {
      const button = panel.getByRole("button", { name: "Stop all" })
      await button.waitFor({ timeout: 20_000 })
      await button.click()
      const ended = await until(async () => {
        const { groups } = await tabState()
        const group = groups.find((candidate) => candidate.title === "Kilo · ended")
        return group ?? undefined
      }, 20_000, "the group turns ended")
      stoppedGroupId = ended.id
    } catch (error) {
      stopError = error
    }
  }

  const result = await run(
    (step) => {
      if (step.results.length === 0) return { name: "browser_navigate", args: { url: localOrigin } }
      if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
      if (step.results.length === 2) {
        // Stop all while the CLI waits for the model's next step; the next call is the one after the stop.
        return (async () => {
          await stopAll()
          return { name: "browser_navigate", args: { url: `${localOrigin}/?after-stop=1` } }
        })()
      }
      return undefined
    },
    {},
  )

  const next = result.last.results[2] ?? ""
  const state = await tabState()
  const ended = state.groups.filter((candidate) => candidate.title === "Kilo · ended")
  expect(stopError === undefined, `Stop all did not run: ${String(stopError)}`)
  expect(ended.length > 0, `no "Kilo · ended" group: ${JSON.stringify(state.groups)}`)
  expect(
    ended.some((group) => group.collapsed === true && group.color === "grey"),
    `the ended group is not collapsed and grey: ${JSON.stringify(ended)}`,
  )
  expect(next.includes("The user stopped this browser session"), `the next call was not user_stopped:\n${next.slice(0, 600)}`)
  return {
    ended,
    hubLog: result.hub.log.text.slice(-1_500),
    next: next.slice(0, 600),
    stoppedGroupId,
  }
}

async function unpaired() {
  // The extension is loaded but its switch is off: nothing dials the hub the CLI starts for itself.
  const result = await run((step) =>
    step.results.length === 0 ? { name: "browser_navigate", args: { url: localOrigin } } : undefined,
  {}, {})
  const reply = result.last.results[0] ?? ""
  const output = `${result.stdout}\n${result.stderr}`
  const hint = "Install the Kilo browser extension"
  expect(reply.includes("The browser is not available right now"), `the CLI did not get browser_unavailable:\n${reply.slice(0, 500)}`)
  expect(output.includes(hint), `the install hint is missing from the CLI output:\n${output.slice(-2_000)}`)
  return {
    hubLog: result.hub.log.text.slice(-1_500),
    reply: reply.slice(0, 400),
    run: { code: result.code, stderr: result.stderr.slice(-1_500) },
  }
}

async function download() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: `${localOrigin}/download` } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { name: "browser_click", args: { element: "the report link", target: ref } } : undefined
    }
    return undefined
  }

  // A download the browser started may be saved by Playwright or by Chrome's own default directory, depending on
  // which download behavior the extension applet overrides; watch both.
  const saved: string[] = []
  const watch = (page: any) =>
    page.on("download", async (item: any) => {
      try {
        const file = await item.path()
        if (file) saved.push(await fs.readFile(file, "utf8"))
      } catch {
        // A stopped download has no path.
      }
    })
  context.on("page", watch)
  for (const page of context.pages()) watch(page)

  const clear = async () => {
    saved.length = 0
    for (const file of await fs.readdir(downloadsDirectory).catch(() => [] as string[])) {
      if (file.startsWith("report")) await fs.rm(path.join(downloadsDirectory, file), { force: true }).catch(() => undefined)
    }
  }
  const chromeDownloads = async () =>
    (await fs.readdir(downloadsDirectory).catch(() => [] as string[])).filter((file) => file.startsWith("report"))

  await clear()
  const hitsBefore = downloadHits.length
  const stopped = await run(plan, {})
  const stoppedText = stopped.last.results[2] ?? ""
  const stoppedHits = downloadHits.length - hitsBefore
  const stoppedFiles = await chromeDownloads()
  expect(stoppedText.includes("needs the user's permission"), `the stopped download does not ask for approval:\n${stoppedText.slice(0, 600)}`)
  expect(stoppedHits === 1, `the click ran ${stoppedHits} times instead of once`)
  expect(stoppedFiles.length === 0 && saved.length === 0, `the stopped download was saved: ${JSON.stringify(stoppedFiles)} ${JSON.stringify(saved)}`)

  await clear()
  const approvedPlan: Plan = (step) => {
    if (step.results.length === 0) return { name: "browser_navigate", args: { url: `${localOrigin}/download` } }
    if (step.results.length === 1) return { name: "browser_snapshot", args: {} }
    if (step.results.length === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { name: "browser_click", args: { element: "the report link", target: ref } } : undefined
    }
    if (step.results.length === 3) {
      // The approved post-action step: the CLI never repeats it, the model must send the identical call.
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { name: "browser_click", args: { element: "the report link", target: ref } } : undefined
    }
    return undefined
  }
  const hitsBeforeApproved = downloadHits.length
  const approved = await run(approvedPlan, { allowSensitive: true })
  const approval = approved.last.results[2] ?? ""
  const repeat = approved.last.results[3] ?? ""
  const approvedHits = downloadHits.length - hitsBeforeApproved
  expect(approval.includes("Approved. Repeat the same step"), `the approval is missing:\n${approval.slice(0, 600)}`)
  expect(!repeat.includes("permission"), `the repeat did not run:\n${repeat.slice(0, 600)}`)
  expect(approvedHits === 2, `the approved click ran ${approvedHits} times instead of twice (once stopped, once approved)`)
  const kept = await until(
    async () => {
      if (saved.some((body) => body.includes("report-body"))) return saved
      const files = await chromeDownloads()
      if (files.length > 0) {
        const bodies = await Promise.all(
          files.map((file) => fs.readFile(path.join(downloadsDirectory, file), "utf8").catch(() => "")),
        )
        if (bodies.some((body) => body.includes("report-body"))) return bodies
      }
      return undefined
    },
    20_000,
    "the approved download is saved",
  )
  return {
    approved: approval.slice(0, 400),
    chrome: await chromeDownloads(),
    hubLogs: [stopped.hub.log.text.slice(-1_000), approved.hub.log.text.slice(-1_000)],
    kept,
    repeat: repeat.slice(0, 400),
    saved,
    stopped: stoppedText.slice(0, 500),
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

let base = ""
const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  download,
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

try {
  await launch(base)
  if (scenario !== "unpaired") await enableLocalAgents(base)
  else panel = await context.newPage()
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
