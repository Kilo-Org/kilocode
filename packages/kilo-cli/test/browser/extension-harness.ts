// Shared harness for the real extension-backend runners (extension-e2e, perf, UX, bench, Firefox ports): a real
// Chromium launch with the built MV3 extension, the "Allow local agents" switch, a loopback hub with its pairing page,
// a scripted OpenAI-compatible model and real `kilo2 run` invocations. Not a `bun test` file.
//
// API (everything else in this file is a helper these use):
//
//   const model = startModel()                                  // scripted Chat Completions server; set model.plan per run
//   const browser = await launchChromium({ extension, profile, downloads })
//       // spawns Chromium itself (no Playwright launch), reads DevToolsActivePort, connects Playwright over CDP with
//       // `noDefaults` through a logging proxy: browser.cdp.methods lists every CDP method the harness sent, and
//       // browser.cdp.downloadBehavior must stay empty (Browser.setDownloadBehavior hands downloads to DevTools and
//       // bypasses the extension's chrome.downloads guard). browser.close() disconnects and kills the process.
//   const panel = await enableLocalAgents(browser)               // side panel → Settings → "Allow local agents"
//   const bridge: Bridge = { base, binary, browser, model, panel }
//   const result = await runAgent(bridge, plan, settings, { pair })
//       // fresh home + `kilo2 browser hub --loopback` + pairing.url + pairing page + `kilo2 run`, then stops the hub
//
// Environment: E2E_CHROMIUM (executable; default playwright-core's build), E2E_CHROMIUM_ARGS (extra flags, space
// separated), E2E_DSF (--force-device-scale-factor). Run under `xvfb-run -a -s "-screen 0 1920x1080x24"`: the window
// is the real 1280x900 window, not an emulated viewport, so it must fit the virtual screen.
import type { Subprocess } from "bun"
import * as Png from "@kilocode/kilo-plugin/browser/png"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import path from "node:path"

// playwright-core belongs to the plugin workspace, not this package, so the specifier is resolved from there at
// runtime: a static import would depend on hoisting that the workspace does not promise.
const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright = (await import(Bun.resolveSync("playwright-core", pluginDirectory))) as unknown as Playwright

export const chromiumExecutable = process.env.E2E_CHROMIUM ?? playwright.chromium.executablePath()
export const defaultExtensionDirectory =
  process.env.E2E_EXTENSION_DIR ?? path.resolve(import.meta.dirname, "../../../../cloud/apps/extension/.output/chrome-mv3")

/**
 * The extension APIs the harness evaluates inside the service worker. The CLI package has no extension typings, so
 * this is the narrow global the evaluated callbacks use; each result is validated before the harness reads it.
 */
declare const chrome: {
  downloads: {
    onCreated: { addListener(listener: (item: Record<string, unknown>) => void): void }
    search(query: Record<string, unknown>): Promise<unknown>
    onDeterminingFilename: {
      addListener(listener: (item: Record<string, unknown>, suggest: () => void) => void): void
    }
  }
  storage: { local: { get(key: string): Promise<unknown> } }
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

export type Locator = {
  click(): Promise<void>
  getAttribute(name: string): Promise<string | null>
  waitFor(options?: { timeout?: number }): Promise<void>
}

export type CdpSession = {
  on(event: string, listener: (payload: unknown) => void): void
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export type Worker = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
  url(): string
}

export type Page = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  getByRole(role: string, options?: { name?: string }): Locator
  goto(url: string): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): void
  reload(): Promise<unknown>
  setDefaultTimeout(timeout: number): void
  url(): string
}

export type Route = { fulfill(options: { json: unknown; status: number }): Promise<void>; request(): { url(): string } }

export type PlaywrightBrowser = {
  close(): Promise<void>
  contexts(): Context[]
  newBrowserCDPSession(): Promise<CdpSession>
}

export type Context = {
  addInitScript(script: { content: string }): Promise<void>
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
    connectOverCDP(endpoint: string, options: Record<string, unknown>): Promise<unknown>
    executablePath(): string
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------------------------

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

export function field(value: unknown, key: string): unknown {
  return record(value)?.[key]
}

export async function until<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeout = 20_000,
  label = "condition",
): Promise<T> {
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

export async function freePort(): Promise<number> {
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

export function tap(stream: ReadableStream<Uint8Array>, into: { text: string }, limit = 200_000) {
  void (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        into.text += decoder.decode(value, { stream: true })
        if (into.text.length > limit) into.text = into.text.slice(-limit / 2)
      }
    } catch {
      // The stream closes when the process exits.
    }
  })()
}

/** The ref a snapshot reported for one role and name, e.g. `button "Click me"`. */
export function refOf(snapshot: string, pattern: RegExp): string | undefined {
  return pattern.exec(snapshot)?.[1]
}

export function decodePng(dataUrl: string | undefined): Png.Image | undefined {
  if (!dataUrl) return undefined
  const comma = dataUrl.indexOf(",")
  if (comma < 0) return undefined
  try {
    return Png.decode(Buffer.from(dataUrl.slice(comma + 1), "base64"))
  } catch {
    return undefined
  }
}

export function pixel(image: Png.Image | undefined, x: number, y: number) {
  if (!image) return undefined
  const at = (y * image.width + x) * image.channels
  return [image.data[at], image.data[at + 1], image.data[at + 2]]
}

/** A JSON object the tool rendered, possibly inside observation sections. */
export function jsonOf(text: string): unknown {
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
export function toolTimes(stdout: string): { start: number; end: number }[] {
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

// ---------------------------------------------------------------------------------------------
// Scripted model: one Chat Completions endpoint that answers from the current plan.
// ---------------------------------------------------------------------------------------------

export type Call = { name: string; args: unknown }
export type Step = { calls: Call[]; results: string[]; images: string[] }
export type Plan = (step: Step) => Promise<Call | undefined> | Call | undefined

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

function stepOf(messages: unknown): Step {
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

const usage = (model: string) =>
  `data: ${JSON.stringify({ choices: [], id: "local", model, object: "chat.completion.chunk", usage: { completion_tokens: 2, prompt_tokens: 10, total_tokens: 12 } })}\n\n`

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
    usage(model),
    "data: [DONE]\n\n",
  ].join("")

const answer = (model: string, text: string) =>
  [chunk(model, { content: text, role: "assistant" }, null), chunk(model, {}, "stop"), usage(model), "data: [DONE]\n\n"].join("")

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })

export type ScriptedModel = {
  /** Every browser-tool request of the current run, in order; `runAgent` clears it before each run. */
  readonly history: Step[]
  /** Errors the plan threw; the run ended at that step. `runAgent` clears it before each run. */
  readonly planErrors: string[]
  readonly origin: string
  /** Answers the next browser-tool request; `undefined` ends the run with a plain answer. */
  plan: Plan | undefined
  stop(): void
}

/**
 * The scripted model. A request without browser tools (title generation and similar) gets a plain answer; a request
 * with them is answered from `plan`, as a direct `browser_*` call or, when the tools are registered as a Code Mode
 * namespace (#16317), as an `execute` call of `tools.browser.<method>`.
 */
export function startModel(): ScriptedModel {
  const server = Bun.serve({
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
      const step = stepOf(field(body, "messages"))
      state.history.push(step)
      // A throwing plan ends the run: answering 500 would make the CLI retry the same step for minutes.
      const next =
        state.plan === undefined
          ? undefined
          : await Promise.resolve()
              .then(() => state.plan?.(step))
              .catch((error: unknown) => {
                state.planErrors.push(`step ${step.results.length}: ${error instanceof Error ? error.message : String(error)}`)
                return undefined
              })
      if (next === undefined) return sse(answer(name, "Browser E2E finished"))
      if (tools.some((tool) => tool.startsWith("browser_"))) return sse(toolCall(name, next.name, next.args))
      const method = next.name.startsWith("browser_") ? next.name.slice("browser_".length) : next.name
      const code = `return await tools.browser.${method}(${JSON.stringify(next.args)})`
      return sse(toolCall(name, "execute", { code }))
    },
  })
  const state: ScriptedModel = {
    history: [],
    origin: server.url.origin,
    plan: undefined,
    planErrors: [],
    stop: () => server.stop(true),
  }
  return state
}

// ---------------------------------------------------------------------------------------------
// Chromium: spawned by the harness, connected over CDP through a logging proxy.
// ---------------------------------------------------------------------------------------------

/** Every CDP command the harness sent, by method; the download-behavior commands are listed separately. */
export type CdpLog = { downloadBehavior: string[]; methods: Map<string, number>; sent: number }

type CdpLink = {
  client: { close(): void; send(data: string): unknown } | undefined
  pending: string[]
  upstream: WebSocket
}

/**
 * A WebSocket proxy between Playwright and Chromium's browser endpoint. Playwright multiplexes every target over this
 * one flat connection, so the proxy sees every command the harness sends to the browser, its pages and its workers.
 */
function cdpProxy(upstreamUrl: string) {
  const log: CdpLog = { downloadBehavior: [], methods: new Map(), sent: 0 }
  const server = Bun.serve<CdpLink>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, srv) {
      const upstream = new WebSocket(upstreamUrl)
      upstream.binaryType = "arraybuffer"
      const link: CdpLink = { client: undefined, pending: [], upstream }
      // Chromium only answers commands, so nothing arrives from upstream before the client's first message.
      upstream.addEventListener("open", () => {
        for (const message of link.pending) upstream.send(message)
        link.pending.length = 0
      })
      upstream.addEventListener("message", (event) => {
        const data = event.data
        link.client?.send(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"))
      })
      upstream.addEventListener("close", () => link.client?.close())
      upstream.addEventListener("error", () => link.client?.close())
      if (srv.upgrade(request, { data: link })) return undefined
      upstream.close()
      return new Response("expected a WebSocket upgrade", { status: 400 })
    },
    websocket: {
      maxPayloadLength: 512 * 1024 * 1024,
      perMessageDeflate: false,
      open(client) {
        client.data.client = client
      },
      // CDP is JSON text; a binary frame is decoded and forwarded as text.
      message(client, message) {
        const text = typeof message === "string" ? message : message.toString("utf8")
        try {
          const method = field(JSON.parse(text), "method")
          if (typeof method === "string") {
            log.sent += 1
            log.methods.set(method, (log.methods.get(method) ?? 0) + 1)
            if (/setDownloadBehavior|setDownloadOptions/i.test(method)) log.downloadBehavior.push(text.slice(0, 500))
          }
        } catch {
          // Not JSON: forwarded unchanged.
        }
        const link = client.data
        if (link.upstream.readyState === WebSocket.OPEN) link.upstream.send(text)
        else link.pending.push(text)
      },
      close(client) {
        client.data.upstream.close()
      },
    },
  })
  return { log, server, url: `ws://127.0.0.1:${server.port}` }
}

/** Extension service-worker console and exceptions, through the browser-level CDP session. */
export class ServiceWorkerLog {
  readonly lines: string[] = []
  private attached = new Map<string, string>()
  private nextId = 1
  private session: CdpSession | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly browser: { newBrowserCDPSession(): Promise<CdpSession> },
    private readonly extensionId: string,
  ) {}

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
    return info["type"] === "service_worker" && typeof info["url"] === "string" && info["url"].includes(this.extensionId)
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

export type LaunchOptions = {
  /** The unpacked extension to load. */
  extension: string
  /** The Chromium user-data-dir; created with a `Default/Preferences` before launch. */
  profile: string
  /** Chrome's own default download directory (`download.default_directory`); omitted keeps $HOME/Downloads. */
  downloads?: string
  /** Extra Chromium flags after the harness's own. */
  args?: string[]
  /** Extra top-level `Default/Preferences` keys, e.g. `profile.default_content_setting_values`. */
  preferences?: Record<string, unknown>
}

export type Launched = {
  browser: PlaywrightBrowser
  cdp: CdpLog
  /** Chromium's stdout and stderr, trimmed. */
  chromiumLog: { text: string }
  context: Context
  extensionId: string
  pid: number
  swLog: ServiceWorkerLog
  worker: Worker
  close(): Promise<void>
}

/**
 * Chromium's id for an unpacked extension: the first 128 bits of SHA-256 over the manifest `key` (DER bytes) when it
 * has one, otherwise over the absolute directory path, written with the letters a-p for the hex digits 0-f.
 */
export async function unpackedExtensionId(directory: string): Promise<string> {
  const manifest = record(JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")))
  const key = manifest?.["key"]
  const input = typeof key === "string" ? Buffer.from(key, "base64") : Buffer.from(await fs.realpath(directory))
  const hex = new Bun.CryptoHasher("sha256").update(input).digest("hex").slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("")
}

/** The DevTools endpoint Chromium writes into the profile once `--remote-debugging-port=0` picked a port. */
async function devtoolsEndpoint(profile: string, exited: () => boolean): Promise<string> {
  return until(async () => {
    if (exited()) throw new Error("Chromium exited before it opened its DevTools port")
    const text = await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "")
    const [port, browserPath] = text.split("\n")
    return port && browserPath ? `ws://127.0.0.1:${port.trim()}${browserPath.trim()}` : undefined
  }, 30_000, "Chromium writes DevToolsActivePort")
}

/**
 * Launches Chromium the way a user's browser runs: the harness spawns the executable with a real profile, so Chrome's
 * own download manager (and the extension's chrome.downloads guard) handles every download. Playwright only connects
 * over CDP with `noDefaults`, which skips its `Browser.setDownloadBehavior` and viewport emulation; the proxy's log
 * proves it.
 */
export async function launchChromium(options: LaunchOptions): Promise<Launched> {
  await fs.access(path.join(options.extension, "manifest.json"))
  if (!existsSync(chromiumExecutable)) {
    throw new Error(`no Chromium at ${chromiumExecutable}; install playwright-core's browser or set E2E_CHROMIUM`)
  }
  await fs.mkdir(path.join(options.profile, "Default"), { recursive: true })
  if (options.downloads !== undefined) await fs.mkdir(options.downloads, { recursive: true })
  const preferences = {
    browser: { has_seen_welcome_page: true },
    ...(options.downloads === undefined
      ? {}
      : {
          download: { default_directory: options.downloads, directory_upgrade: true, prompt_for_download: false },
          savefile: { default_directory: options.downloads },
        }),
    ...options.preferences,
  }
  await fs.writeFile(path.join(options.profile, "Default", "Preferences"), JSON.stringify(preferences))

  const args = [
    `--user-data-dir=${options.profile}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--disable-search-engine-choice-screen",
    // The VM's AppArmor profile blocks Chromium's user-namespace sandbox; Playwright's own launch passed the same flag.
    "--no-sandbox",
    `--disable-extensions-except=${options.extension}`,
    `--load-extension=${options.extension}`,
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,900",
    ...(process.env.E2E_DSF === undefined ? [] : [`--force-device-scale-factor=${process.env.E2E_DSF}`]),
    ...(process.env.E2E_CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? []),
    ...(options.args ?? []),
    "about:blank",
  ]
  const chromiumLog = { text: "" }
  let exited = false
  const child = Bun.spawn([chromiumExecutable, ...args], { stderr: "pipe", stdin: "ignore", stdout: "pipe" })
  void child.exited.then(() => {
    exited = true
  })
  tap(child.stdout as ReadableStream<Uint8Array>, chromiumLog, 40_000)
  tap(child.stderr as ReadableStream<Uint8Array>, chromiumLog, 40_000)
  const kill = async () => {
    if (exited) return
    child.kill("SIGTERM")
    await Promise.race([child.exited, Bun.sleep(5_000)])
    if (!exited) child.kill("SIGKILL")
    await Promise.race([child.exited, Bun.sleep(2_000)])
  }

  let proxy: ReturnType<typeof cdpProxy> | undefined
  try {
    proxy = cdpProxy(await devtoolsEndpoint(options.profile, () => exited))
    const browser = (await playwright.chromium.connectOverCDP(proxy.url, {
      noDefaults: true,
      timeout: 30_000,
    })) as PlaywrightBrowser
    const context = browser.contexts()[0]
    if (context === undefined) throw new Error("the CDP connection has no default context")
    context.setDefaultTimeout(20_000)
    // Chromium's own component extensions (contextual tasks, hangouts) run service workers too; Playwright's launch
    // switched them off, a real browser does not. The unpacked extension's id is derived from its path.
    const extensionId = await unpackedExtensionId(options.extension)
    const worker = await until(
      () => context.serviceWorkers().find((candidate) => new URL(candidate.url()).host === extensionId),
      30_000,
      `the service worker of ${extensionId} starts`,
    )
    const swLog = new ServiceWorkerLog(browser, extensionId)
    await swLog.start()
    const server = proxy.server
    return {
      browser,
      cdp: proxy.log,
      chromiumLog,
      context,
      extensionId,
      pid: child.pid,
      swLog,
      worker,
      close: async () => {
        swLog.stop()
        await Promise.race([browser.close().catch(() => undefined), Bun.sleep(5_000)])
        await kill()
        server.stop(true)
      },
    }
  } catch (error) {
    await kill()
    proxy?.server.stop(true)
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- chromium ---\n${chromiumLog.text.slice(-2_000)}`)
  }
}

/** The CDP log as a report field: total, the download-behavior commands (must be empty), and every method's count. */
export function cdpReport(log: CdpLog) {
  return {
    downloadBehavior: log.downloadBehavior,
    methods: Object.fromEntries([...log.methods.entries()].sort(([a], [b]) => a.localeCompare(b))),
    sent: log.sent,
  }
}

/**
 * A copy of the built extension with the optional `downloads` permission promoted to required: automation cannot
 * answer Chrome's optional-permission prompt, and this is the state it is in after the user accepts it (the cloud
 * e2e does the same).
 */
export async function promoteDownloadsCopy(source: string, target: string) {
  await fs.rm(target, { force: true, recursive: true })
  await fs.cp(source, target, { recursive: true })
  const manifestPath = path.join(target, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    optional_permissions?: string[]
    permissions?: string[]
  }
  const optional = (manifest.optional_permissions ?? []).filter((permission) => permission !== "downloads")
  const permissions = [...(manifest.permissions ?? [])]
  if (!permissions.includes("downloads")) permissions.push("downloads")
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, optional_permissions: optional, permissions }, null, 2))
  return target
}

// ---------------------------------------------------------------------------------------------
// The extension's own UI and state.
// ---------------------------------------------------------------------------------------------

type ChromeExtensionApi = {
  runtime?: { lastError?: { message?: string } }
  storage?: { local?: { set(items: Record<string, unknown>, callback: () => void): void } }
}

async function seedAuth(panel: Page) {
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

/**
 * Turns on "Allow local agents" through the extension's own settings page, as a signed-in user would. Returns the
 * side panel and what the switch stored (`kiloLocalAgentSettings`), for the caller to assert.
 */
export async function enableLocalAgents(launched: Launched): Promise<{ panel: Page; stored: unknown }> {
  const { context, extensionId, worker } = launched
  // Auth validation and organization fetches: the settings header only exists for a signed-in session. Both the
  // production API base and a local-stack build (http://localhost:3000) are answered, so either build signs in.
  const apiOrigins = new Set(["https://app.kilo.ai", "http://localhost:3000", ...(process.env.E2E_API_ORIGIN ? [process.env.E2E_API_ORIGIN] : [])])
  await context.route(
    (url) => apiOrigins.has(url.origin) && url.pathname.startsWith("/api/"),
    (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === "/api/user") return route.fulfill({ json: { google_user_email: "e2e@kilo.ai" }, status: 200 })
      if (pathname === "/api/organizations") return route.fulfill({ json: { organizations: [] }, status: 200 })
      return route.fulfill({ json: {}, status: 200 })
    },
  )
  // A real user answers the optional-permission prompt; automation cannot. The page grants it the way an accepted
  // prompt would, keeping the flow deterministic (loopback pairing does not need the permission).
  await context.addInitScript({
    content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
  })
  const panel = await context.newPage()
  panel.setDefaultTimeout(20_000)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await seedAuth(panel)
  await panel.reload()
  const settings = panel.getByRole("button", { name: "Settings" })
  await settings.waitFor()
  await settings.click()
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  await toggle.waitFor()
  await until(async () => (await toggle.getAttribute("aria-checked")) === "false" || undefined, 10_000, "the switch starts off")
  await toggle.click()
  await until(async () => (await toggle.getAttribute("aria-checked")) === "true" || undefined, 10_000, "the switch turns on")
  const stored = await worker.evaluate(() => chrome.storage.local.get("kiloLocalAgentSettings"))
  return { panel, stored }
}

export type TabInfo = { active?: boolean; groupId?: number; id?: number; title?: string; url?: string }
export type GroupInfo = { collapsed?: boolean; color?: string; id?: number; title?: string }
export type TabState = { groups: GroupInfo[]; tabs: TabInfo[] }

/** The `chrome.tabs.Tab` fields the runners read, validated field by field. */
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

export function groupOf(value: unknown): GroupInfo {
  const group = record(value) ?? {}
  return {
    ...(typeof group["collapsed"] === "boolean" ? { collapsed: group["collapsed"] } : {}),
    ...(typeof group["color"] === "string" ? { color: group["color"] } : {}),
    ...(typeof group["id"] === "number" ? { id: group["id"] } : {}),
    ...(typeof group["title"] === "string" ? { title: group["title"] } : {}),
  }
}

export async function tabsOf(worker: Worker): Promise<TabInfo[]> {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}))
  return Array.isArray(tabs) ? tabs.map(tabOf) : []
}

export async function tabState(worker: Worker): Promise<TabState> {
  const tabs = await tabsOf(worker)
  const groups = await worker.evaluate(() => chrome.tabGroups.query({}))
  return { groups: Array.isArray(groups) ? groups.map(groupOf) : [], tabs }
}

export async function groupById(worker: Worker, id: number): Promise<GroupInfo> {
  return groupOf(await worker.evaluate(async (groupId: number) => chrome.tabGroups.get(groupId), id))
}

/** A tab the user opened: created over the browser's CDP session, so it has no opener and no session claims it. */
export async function openUserTab(launched: Launched, url: string): Promise<number> {
  const cdp = await launched.browser.newBrowserCDPSession()
  await cdp.send("Target.createTarget", { newWindow: false, url })
  return until(async () => (await tabsOf(launched.worker)).find((tab) => tab.url === url)?.id, 10_000, "the user tab appears")
}

export type DownloadEvent = { event: "created" | "determining"; filename?: string; id?: number; url?: string }

/**
 * Listens to `chrome.downloads.onCreated` and `onDeterminingFilename` inside the extension's service worker.
 * `onDeterminingFilename` only fires when Chrome's own download manager owns the download, never under a DevTools
 * `Browser.setDownloadBehavior` override, so its events prove the production download path. The listener suggests
 * nothing, which keeps Chrome's own filename.
 */
export async function armDownloadProbe(worker: Worker) {
  await worker.evaluate(() => {
    const global = globalThis as { __e2eDownloads?: DownloadEvent[] }
    if (global.__e2eDownloads) return
    const events: DownloadEvent[] = []
    global.__e2eDownloads = events
    const entry = (event: DownloadEvent["event"], item: Record<string, unknown>): DownloadEvent => ({
      event,
      ...(typeof item["filename"] === "string" ? { filename: item["filename"] } : {}),
      ...(typeof item["id"] === "number" ? { id: item["id"] } : {}),
      ...(typeof item["url"] === "string" ? { url: item["url"] } : {}),
    })
    chrome.downloads.onCreated.addListener((item) => events.push(entry("created", item)))
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      events.push(entry("determining", item))
      suggest()
    })
  })
}

export async function readDownloadProbe(worker: Worker): Promise<DownloadEvent[]> {
  const events = await worker.evaluate(() => (globalThis as { __e2eDownloads?: unknown }).__e2eDownloads)
  return Array.isArray(events) ? (events as DownloadEvent[]) : []
}

/** Chrome's own download list (`chrome.downloads.search`): state, error and final filename of every item. */
export async function downloadItems(worker: Worker): Promise<Record<string, unknown>[]> {
  const items = await worker.evaluate(() => chrome.downloads.search({}))
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    const value = record(item) ?? {}
    const keep = ["id", "url", "filename", "state", "error", "danger", "exists", "bytesReceived", "byExtensionId"]
    return Object.fromEntries(keep.filter((key) => key in value).map((key) => [key, value[key]]))
  })
}

// ---------------------------------------------------------------------------------------------
// Hub: start `kilo2 browser hub --loopback`, ask it for a pairing URL over its CLI socket, open that page.
// ---------------------------------------------------------------------------------------------

export type HubEntry = { hubId: string; paired?: boolean; port?: number; socket?: string }

export type Hub = {
  child: Subprocess
  entry: () => Promise<HubEntry | undefined>
  log: { text: string }
  port: number
  stop: () => Promise<void>
}

export type Rule = { action: string; effect: "allow" | "ask" | "deny"; resource: string }
export type Settings = { allowSensitive?: boolean; auto?: boolean; rules?: Rule[]; strict?: boolean }

/** A non-interactive run cannot answer a tool-level ask, so the harness config allows the tools it drives. */
export const TOOL_RULES: Rule[] = [
  "execute",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_tabs",
  "browser_take_screenshot",
].map((action) => ({ action, effect: "allow" as const, resource: "*" }))

/** The built-in defaults the SPEC documents for the localhost family; without them every act reads as an ask. */
export const LOCALHOST_RULES: Rule[] = [
  { action: "browser", effect: "allow", resource: "*:http://localhost:*" },
  { action: "browser", effect: "allow", resource: "*:http://127.0.0.1:*" },
  { action: "browser", effect: "allow", resource: "*:http://*.localhost:*" },
  { action: "browser", effect: "allow", resource: "*:https://localhost:*" },
]

export function cliConfig(settings: Settings, modelOrigin: string) {
  return {
    model: "local/echo",
    providers: {
      local: {
        models: { echo: { limit: { context: 200_000, output: 4_000 }, name: "Echo" } },
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { apiKey: "local-key", baseURL: `${modelOrigin}/v1` },
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

/** The CLI's environment for one isolated home; `config` is the full `KILO_CONFIG_CONTENT` object. */
export function cliEnvironment(root: string, extensionId: string, config: unknown) {
  const run = path.join(root, "run")
  return {
    ...process.env,
    HOME: root,
    KILO_API_KEY: "",
    KILO_AUTH_CONTENT: "",
    KILO_BROWSER_DATA_DIR: path.join(root, "data", "kilo2", "browser"),
    KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
    KILO_BROWSER_RUN_DIR: path.join(run, "browser"),
    KILO_CONFIG_CONTENT: JSON.stringify(config),
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

export async function prepareHome(root: string) {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(path.join(root, "bin"), { recursive: true })
  await fs.mkdir(path.join(root, "run"), { mode: 0o700, recursive: true })
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

/**
 * Starts `kilo2 browser hub --loopback` and waits until it registers. `ports` are tried in order (an assigned range
 * can overlap the kernel's ephemeral range, so a port may be taken); without them a free port is picked.
 */
export async function startHub(binary: string, root: string, env: Record<string, string | undefined>, ports: number[] = []): Promise<Hub> {
  const candidates = ports.length ? ports.slice(0, 5) : [await freePort()]
  const tried: string[] = []
  for (const chosen of candidates) {
    const log = { text: "" }
    const child = Bun.spawn([binary, "browser", "hub", "--loopback", "--port", String(chosen)], {
      cwd: root,
      env,
      stderr: "pipe",
      stdout: "pipe",
    })
    tap(child.stdout as ReadableStream<Uint8Array>, log)
    tap(child.stderr as ReadableStream<Uint8Array>, log)
    const started = Date.now()
    const registered = await until(
      async () => (child.exitCode !== null || log.text.includes("EADDRINUSE") ? false : await readHubEntry(root)),
      30_000,
      "the hub registers itself",
    ).catch((error: unknown) => String(error))
    if (typeof registered === "object") {
      return {
        child,
        entry: () => readHubEntry(root),
        log,
        port: chosen,
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
    const alive = child.exitCode === null
    child.kill("SIGKILL")
    tried.push(
      `port ${chosen}: ${registered === false ? `hub failed after ${Date.now() - started} ms (exit ${alive ? "none, still running" : child.exitCode})` : registered}\n${log.text.slice(-1_500)}`,
    )
    if (!log.text.includes("EADDRINUSE")) break
  }
  throw new Error(`the hub did not start:\n${tried.join("\n---\n")}`)
}

/** One JSON-RPC call the hub answers itself, over the same 4-byte-framed socket the CLI uses. */
export async function hubRequest(socketPath: string, method: string, params: unknown): Promise<unknown> {
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
export async function pair(hub: Hub, launched: Launched) {
  const entry = await hub.entry()
  if (entry?.socket === undefined) throw new Error("the hub registry has no socket")
  const answer = record(await hubRequest(entry.socket, "pairing.url", {}))
  const url = answer?.["url"]
  if (typeof url !== "string") throw new Error("the hub returned no pairing URL")
  const cdp = await launched.browser.newBrowserCDPSession()
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

/** Everything one runner process holds: the CLI binary, its scratch root, the browser and the model. */
export type Bridge = {
  base: string
  binary: string
  browser: Launched
  model: ScriptedModel
  /** Runs started so far; each gets `<base>/run-<n>`. */
  runs?: number
  /** Hub ports to use in order (e.g. an assigned range); a free port otherwise. */
  ports?: number[]
}

export type Run = {
  code: number
  hub: Hub
  last: Step
  /** Errors the scenario's plan threw; the run ended at the first one. */
  planErrors: string[]
  pngs: string[]
  root: string
  stderr: string
  steps: Step[]
  stdout: string
}

export type RunOptions = {
  /** Pair the extension with this run's hub first (default true). */
  pair?: boolean
  /** The prompt passed to `kilo2 run`. */
  prompt?: string
  /** Extra `kilo2 run` flags. */
  args?: string[]
  /** Kill the run after this many milliseconds (default 240 s). */
  timeout?: number
}

export async function runAgent(bridge: Bridge, plan: Plan, settings: Settings, options: RunOptions = {}): Promise<Run> {
  bridge.runs = (bridge.runs ?? 0) + 1
  const root = path.join(bridge.base, `run-${bridge.runs}`)
  await prepareHome(root)
  const env = cliEnvironment(root, bridge.browser.extensionId, cliConfig(settings, bridge.model.origin))
  const ports = bridge.ports ?? []
  const start = ((bridge.runs - 1) * 5) % Math.max(ports.length, 1)
  const hub = await startHub(bridge.binary, root, env, [...ports.slice(start), ...ports.slice(0, start)])
  try {
    if (options.pair !== false) await pair(hub, bridge.browser)
    bridge.model.history.length = 0
    bridge.model.planErrors.length = 0
    bridge.model.plan = plan
    const child = Bun.spawn(
      [
        bridge.binary,
        "run",
        options.prompt ?? "Check the browser bridge.",
        "--model",
        "local/echo",
        "--standalone",
        "--format",
        "json",
        ...(settings.auto ? ["--auto"] : []),
        ...(options.args ?? []),
      ],
      { cwd: root, env, stderr: "pipe", stdout: "pipe", timeout: options.timeout ?? 240_000 },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ])
    bridge.model.plan = undefined
    const steps = [...bridge.model.history]
    const last = steps.at(-1) ?? { calls: [], images: [], results: [] }
    // The screenshot arrives in the run's tool event as a file part with a data URI; the model message may carry only
    // a text reference, so the event stream is the reliable source.
    const pngs = [...stdout.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)].map((match) => match[0])
    return { code, hub, last, planErrors: [...bridge.model.planErrors], pngs, root, stderr, steps, stdout }
  } finally {
    await hub.stop()
  }
}
