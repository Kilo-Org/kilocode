import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { URL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { chromium, type BrowserContext, type LaunchOptions, type Page } from "playwright-core"
import { BrowserDevtools } from "./browser-devtools"
import { capture as element, locate } from "./browser-element"
import { options } from "./browser-runtime"

export type BrowserStatus = "starting" | "ready" | "loading" | "error" | "closed"

export interface BrowserRoute {
  projectId?: string
  sessionId: string
  directory: string
}

export interface BrowserState {
  browserId: string
  projectId?: string
  sessionId: string
  navigation: number
  status: BrowserStatus
  inspecting?: boolean
  url?: string
  title?: string
  screenshot?: string
  mime?: "image/jpeg"
  errors: number
  logs?: string[]
  error?: string
  frameError?: string
}

export interface BrowserElement {
  tag: string
  id?: string
  classes?: string
  text?: string
  selector?: string
  rect?: { x: number; y: number; width: number; height: number }
  hierarchy?: string[]
  html?: string
  styles?: { color?: string; backgroundColor?: string }
  source?: { file: string; line?: number; column?: number }
}

export interface BrowserInspection {
  url?: string
  title?: string
  element?: BrowserElement
  logs: string[]
}

interface BrowserDevtoolsInfo {
  browserId: string
  url: string
}

export interface BrowserBrokerOptions {
  log: (...args: unknown[]) => void
  enabled?: () => boolean
  trusted?: () => boolean
  launch?: (options: LaunchOptions) => Promise<BrowserContextFactory>
  useSystemChrome?: () => boolean
}

export interface BrowserContextFactory {
  debugging?: number
  newContext(options: { serviceWorkers: "block"; viewport: { width: number; height: number } }): Promise<BrowserContext>
  close(): Promise<void>
}

interface Entry {
  route: BrowserRoute
  browserId: string
  context: BrowserContext
  page: Page
  origin: string
  state: BrowserState
  response?: number
}

class BrowserNavigationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "BrowserNavigationError"
  }
}

type RequestBody = {
  sessionID?: unknown
  projectID?: unknown
  directory?: unknown
  url?: unknown
}

const MAX_BODY = 32 * 1024
const MAX_SCREENSHOT = 2 * 1024 * 1024

export function diagnostic(error: unknown, url?: string): string {
  const text = stripVTControlCharacters(error instanceof Error ? error.message : String(error))
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) {
    return `Cannot connect to ${url ?? "the local application"}. Make sure the local server is running.`
  }
  if (/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|Timeout \d+ms exceeded/i.test(text)) {
    return "The local application did not respond in time. Check the server and try again."
  }
  if (/Target page, context or browser has been closed|Browser has been closed/i.test(text)) {
    return "The browser session was closed. Reopen the browser and try again."
  }
  return text
    .split(/\n\s*Call log:/i)[0]
    .replace(/^page\.(?:goto|reload):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
}

function reserve(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Browser developer tools did not receive a local port")))
        return
      }
      server.close((error) => {
        if (error) return reject(error)
        resolve(address.port)
      })
    })
  })
}

function framing(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined
  const options = headers["x-frame-options"]?.trim().toLowerCase()
  if (options && (options === "deny" || options === "sameorigin" || options.startsWith("allow-from"))) {
    return `This application blocks embedded browser previews with X-Frame-Options: ${options.toUpperCase()}.`
  }
  const policy = headers["content-security-policy"]
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("frame-ancestors"))
  if (policy && /(?:^|\s)'(?:none|self)'(?:\s|$)/i.test(policy)) {
    return `This application blocks embedded browser previews with Content-Security-Policy: ${policy}.`
  }
  return undefined
}

function loopback(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  res.end(body)
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error("Request body is too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

export class BrowserBroker {
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly listeners = new Set<(state: BrowserState) => void>()
  private readonly token = randomBytes(32).toString("hex")
  private owner: ((route: BrowserRoute) => BrowserRoute | undefined) | undefined
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()
  private port: number | undefined
  private debugging: number | undefined
  private tools: BrowserDevtools | undefined
  private browser: BrowserContextFactory | undefined
  private browserStarting: Promise<BrowserContextFactory> | undefined
  private starting: Promise<void> | undefined
  private closed = false

  constructor(private readonly opts: BrowserBrokerOptions) {}

  async start(): Promise<void> {
    if (this.closed) throw new Error("Browser broker is closed")
    if (this.port !== undefined) return
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handle(req, res)
      })
      this.server.on("connection", (socket) => {
        this.sockets.add(socket)
        socket.once("close", () => this.sockets.delete(socket))
      })
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        const server = this.server
        const address = server?.address()
        if (!server || !address || typeof address === "string") {
          reject(new Error("Browser broker did not receive a local port"))
          return
        }
        this.port = address.port
        this.tools = new BrowserDevtools(server, address.port, this.opts.log, (browser, active) => {
          const entry = [...this.entries.values()].find((item) => item.browserId === browser)
          if (!entry || entry.state.inspecting === active) return
          entry.state.inspecting = active
          this.emit(entry.state)
        })
        resolve()
      })
    }).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  async env(): Promise<Record<string, string>> {
    await this.start()
    return {
      KILO_BROWSER_BROKER_URL: `http://127.0.0.1:${this.port}`,
      KILO_BROWSER_BROKER_TOKEN: this.token,
    }
  }

  bind(owner: (route: BrowserRoute) => BrowserRoute | undefined): void {
    this.owner = owner
  }

  subscribe(listener: (state: BrowserState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  replay(listener: (state: BrowserState) => void): void {
    for (const entry of this.entries.values()) listener(this.copy(entry.state))
  }

  get(sessionId: string, projectId?: string): BrowserState | undefined {
    const entries = [...this.entries.values()].filter(
      (entry) =>
        entry.route.sessionId === sessionId && (projectId === undefined || entry.route.projectId === projectId),
    )
    return entries.length === 1 ? this.copy(entries[0].state) : undefined
  }

  sessions(): string[] {
    return [...new Set([...this.entries.values()].map((entry) => entry.route.sessionId))]
  }

  open(route: BrowserRoute, target: string): Promise<BrowserState> {
    const scope = this.owner ? this.owner(route) : route
    if (!scope)
      return Promise.reject(new Error("Browser session does not belong to the requested project or directory"))
    return this.serial(this.key(scope.sessionId, scope.projectId), () => this.create(scope, target))
  }

  private async create(scope: BrowserRoute, target: string): Promise<BrowserState> {
    this.available()
    const url = this.validate(target)
    const existing = this.entries.get(this.key(scope.sessionId, scope.projectId))
    if (existing) {
      if (existing.route.directory !== scope.directory) throw new Error("Browser session directory cannot change")
      if (scope.projectId && existing.route.projectId && existing.route.projectId !== scope.projectId) {
        throw new Error("Browser session project cannot change")
      }
      existing.route.projectId = scope.projectId ?? existing.route.projectId
      existing.state.projectId = existing.route.projectId
      const reload = existing.state.status === "ready" && existing.page.url() === url.href
      await this.goto(existing, url, reload)
      return this.copy(existing.state)
    }

    const browser = await this.ensureBrowser()
    this.available()
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage().catch(async (error: unknown) => {
      await context.close().catch((failure: unknown) => this.opts.log("Browser context close failed", failure))
      throw error
    })
    if (this.closed) {
      await context.close().catch((error: unknown) => this.opts.log("Browser context close failed", error))
      throw new Error("Browser broker is closed")
    }
    const entry: Entry = {
      route: { ...scope },
      browserId: randomUUID(),
      context,
      page,
      origin: url.origin,
      state: {
        browserId: "",
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        navigation: 0,
        status: "starting",
        errors: 0,
        logs: [],
      },
    }
    entry.state.browserId = entry.browserId
    const key = this.key(scope.sessionId, scope.projectId)
    this.entries.set(key, entry)
    this.attach(entry)
    await this.route(entry).catch(async (error: unknown) => {
      this.entries.delete(key)
      await context.close().catch((failure: unknown) => this.opts.log("Browser context close failed", failure))
      throw error
    })
    this.emit(entry.state)
    await this.goto(entry, url)
    return this.copy(entry.state)
  }

  devtools(sessionId: string, projectId?: string, theme: "dark" | "light" = "dark"): Promise<BrowserDevtoolsInfo> {
    return this.serial(this.key(sessionId, projectId), async () => {
      this.available()
      const entry = this.require(sessionId, undefined, projectId)
      await this.start()
      const port = this.debugging ?? this.browser?.debugging
      if (!port || !this.tools || typeof entry.context.newCDPSession !== "function") {
        throw new Error("Browser developer tools are unavailable for this browser session")
      }
      const session = await entry.context.newCDPSession(entry.page)
      const info = await session
        .send("Target.getTargetInfo")
        .finally(() =>
          session.detach().catch((error: unknown) => this.opts.log("Browser CDP session close failed", error)),
        )
      return {
        browserId: entry.browserId,
        url: this.tools.open(entry.browserId, info.targetInfo.targetId, port, theme),
      }
    })
  }

  inspect(
    sessionId: string,
    projectId: string | undefined,
    position: { x: number; y: number; width: number; height: number },
    detail = true,
  ): Promise<BrowserInspection> {
    return this.serial(this.key(sessionId, projectId), async () => {
      this.available()
      const entry = this.require(sessionId, undefined, projectId)
      await this.point(entry, position)
      const selected: BrowserElement | undefined = await entry.page.evaluate(element, { ...position, detail })
      if (selected?.source) selected.source = await locate(entry.route.directory, selected.source)
      await this.update(entry)
      return {
        url: entry.state.url,
        title: entry.state.title,
        element: selected,
        logs: [...(entry.state.logs ?? [])],
      }
    })
  }

  input(
    sessionId: string,
    projectId: string | undefined,
    position: { x: number; y: number; width: number; height: number },
    click: boolean,
  ): Promise<void> {
    return this.serial(this.key(sessionId, projectId), async () => {
      this.available()
      const entry = this.require(sessionId, undefined, projectId)
      if (!entry.state.inspecting) return
      const point = await this.point(entry, position)
      await entry.page.mouse.move(point.x, point.y)
      if (!click) return
      await entry.page.mouse.down()
      await entry.page.mouse.up()
    })
  }

  refresh(sessionId: string, projectId?: string): Promise<BrowserState> {
    return this.serial(this.key(sessionId, projectId), async () => {
      this.available()
      const entry = this.require(sessionId, undefined, projectId)
      const url = this.validate(entry.state.url ?? entry.origin)
      await this.goto(entry, url, true)
      return this.copy(entry.state)
    })
  }

  close(sessionId: string, projectId?: string): Promise<void> {
    const entries = [...this.entries.values()].filter(
      (entry) =>
        entry.route.sessionId === sessionId && (projectId === undefined || entry.route.projectId === projectId),
    )
    return Promise.all(
      entries.map((entry) =>
        this.serial(this.key(entry.route.sessionId, entry.route.projectId), async () => {
          const key = this.key(entry.route.sessionId, entry.route.projectId)
          if (this.entries.get(key) !== entry) return
          this.entries.delete(key)
          this.tools?.revoke(entry.browserId)
          await entry.context.close().catch((error: unknown) => this.opts.log("Browser context close failed", error))
          entry.state.status = "closed"
          entry.state.screenshot = undefined
          this.emit(entry.state)
        }),
      ),
    ).then(() => undefined)
  }

  async disposeAsync(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all(
      [...this.entries.values()].map((entry) => this.close(entry.route.sessionId, entry.route.projectId)),
    )
    await this.browserStarting?.catch((error: unknown) => this.opts.log("Browser startup failed", error))
    await this.browser?.close().catch((error: unknown) => this.opts.log("Browser close failed", error))
    this.browser = undefined
    this.debugging = undefined
    this.tools?.dispose()
    this.tools = undefined
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      if (!this.server.listening) resolve()
    })
    this.server = undefined
    this.port = undefined
    this.listeners.clear()
  }

  dispose(): void {
    void this.disposeAsync().catch((error: unknown) => this.opts.log("Browser broker dispose failed", error))
  }

  private async ensureBrowser(): Promise<BrowserContextFactory> {
    if (this.closed) throw new Error("Browser broker is closed")
    if (this.browser) return this.browser
    if (this.browserStarting) return this.browserStarting
    this.browserStarting = (async () => {
      const port = this.opts.launch ? undefined : await reserve()
      const config = options(this.opts.useSystemChrome?.() !== false, port)
      const browser = await (this.opts.launch?.(config) ?? chromium.launch(config))
      this.debugging = ("debugging" in browser ? browser.debugging : undefined) ?? port
      this.browser = browser
      return browser
    })()
    try {
      return await this.browserStarting
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const action =
        this.opts.useSystemChrome?.() === false
          ? "Install a compatible Playwright Chromium browser or enable Use System Chrome in Kilo Settings > Web Tools."
          : "Install Google Chrome or select an existing Playwright Chromium browser in Kilo Settings > Web Tools."
      throw new Error(`${action} ${detail}`.slice(0, 1000), { cause: error })
    } finally {
      this.browserStarting = undefined
    }
  }

  private record(entry: Entry, message: string): void {
    const text = message.replace(/\s+/g, " ").trim().slice(0, 1000)
    if (!text) return
    entry.state.logs = [...(entry.state.logs ?? []), text].slice(-20)
  }

  private attach(entry: Entry): void {
    entry.page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.frame() === entry.page.mainFrame()) {
        entry.response = response.status()
      }
    })
    entry.page.on("console", (message) => {
      const type = message.type()
      if (type === "error") entry.state.errors++
      this.record(entry, `[${type}] ${message.text()}`)
      this.emit(entry.state)
    })
    entry.page.on("pageerror", (error) => {
      entry.state.errors++
      this.record(entry, error.message)
      this.emit(entry.state)
    })
    entry.page.on("popup", (page) => {
      entry.state.errors++
      this.record(entry, "Blocked browser popup")
      this.emit(entry.state)
      void page.close().catch((error: unknown) => this.opts.log("Browser popup close failed", error))
    })
    entry.page.on("framenavigated", (frame) => {
      if (frame !== entry.page.mainFrame()) return
      void this.update(entry).catch((error: unknown) => this.fail(entry, error))
    })
  }

  private async route(entry: Entry): Promise<void> {
    await entry.context.route("**/*", async (route, request) => {
      const target = request.url()
      if (this.allowed(entry, target, Boolean(request.isNavigationRequest?.()))) {
        await route.continue()
        return
      }
      const origin = URL.canParse(target) ? new URL(target).origin : "invalid"
      this.opts.log("Blocked browser request", { sessionId: entry.route.sessionId, origin })
      entry.state.errors++
      this.record(entry, `Blocked browser request: ${origin}`)
      this.emit(entry.state)
      await route.abort("blockedbyclient")
    })
    await entry.context.routeWebSocket("**/*", async (socket) => {
      const target = socket.url()
      if (this.allowed(entry, target)) {
        socket.connectToServer()
        return
      }
      const origin = URL.canParse(target) ? new URL(target).origin : "invalid"
      this.opts.log("Blocked browser WebSocket", { sessionId: entry.route.sessionId, origin })
      entry.state.errors++
      this.record(entry, `Blocked browser request: ${origin}`)
      this.emit(entry.state)
      await socket.close({ code: 1008, reason: "Blocked browser origin" })
    })
  }

  private async goto(entry: Entry, url: URL, reload = false): Promise<void> {
    entry.origin = url.origin
    entry.response = undefined
    entry.state.navigation++
    entry.state.status = "loading"
    entry.state.url = url.href
    entry.state.title = undefined
    entry.state.error = undefined
    entry.state.frameError = undefined
    entry.state.errors = 0
    entry.state.logs = []
    this.emit(entry.state)
    try {
      const response = reload
        ? await entry.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 })
        : await entry.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 })
      entry.response = response?.status() ?? entry.response
      entry.state.frameError = framing(response?.headers?.())
      if (entry.response !== undefined && entry.response >= 400) {
        await this.update(entry)
        await this.capture(entry)
        throw new BrowserNavigationError(`Local application returned HTTP ${entry.response}`, entry.response)
      }
      await this.update(entry)
      await this.capture(entry)
      entry.state.status = "ready"
      this.emit(entry.state)
    } catch (error) {
      entry.state.url = url.href
      this.fail(entry, error)
      throw error
    }
  }

  private async point(
    entry: Entry,
    position: { x: number; y: number; width: number; height: number },
  ): Promise<{ x: number; y: number }> {
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < 0 ||
      position.x > 1 ||
      position.y < 0 ||
      position.y > 1 ||
      !Number.isFinite(position.width) ||
      !Number.isFinite(position.height) ||
      position.width < 1 ||
      position.height < 1
    ) {
      throw new Error("Browser element coordinates are invalid")
    }
    const width = Math.max(1, Math.min(1920, Math.round(position.width)))
    const height = Math.max(1, Math.min(1440, Math.round(position.height)))
    const viewport = entry.page.viewportSize?.()
    if (viewport?.width !== width || viewport.height !== height) {
      await entry.page.setViewportSize({ width, height })
    }
    return { x: position.x * width, y: position.y * height }
  }

  private async update(entry: Entry): Promise<void> {
    entry.state.url = entry.page.url()
    entry.state.title = await entry.page.title().catch(() => undefined)
  }

  private async capture(entry: Entry): Promise<void> {
    const data = await entry.page.screenshot({ type: "jpeg", quality: 70 })
    if (data.byteLength > MAX_SCREENSHOT) throw new Error("Browser screenshot is too large")
    entry.state.screenshot = `data:image/jpeg;base64,${data.toString("base64")}`
    entry.state.mime = "image/jpeg"
    this.emit(entry.state)
  }

  private key(session: string, project?: string): string {
    return `${project ?? ""}\0${session}`
  }

  private async serial<T>(session: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(session)?.catch(() => undefined) ?? Promise.resolve()
    const next = previous.then(operation)
    this.pending.set(session, next)
    try {
      return await next
    } finally {
      if (this.pending.get(session) === next) this.pending.delete(session)
    }
  }

  private available(): void {
    if (this.closed) throw new Error("Browser broker is closed")
    if (this.opts.trusted && !this.opts.trusted()) throw new Error("Browser preview requires a trusted workspace.")
    if (this.opts.enabled && !this.opts.enabled()) {
      throw new Error("Browser automation is disabled. Enable it in Kilo Settings > Experimental.")
    }
  }

  private fail(entry: Entry, error: unknown): void {
    entry.state.status = "error"
    const text = error instanceof Error ? error.message : String(error)
    entry.state.error =
      entry.response && text.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")
        ? `Local application returned HTTP ${entry.response}`
        : diagnostic(error, entry.state.url)
    this.emit(entry.state)
  }

  private require(sessionId: string, directory?: string, projectId?: string): Entry {
    const entries = [...this.entries.values()].filter((entry) => entry.route.sessionId === sessionId)
    if (entries.length === 0) throw new Error("No browser is open for this Agent Manager session")
    const projects = projectId === undefined ? entries : entries.filter((entry) => entry.route.projectId === projectId)
    if (projects.length === 0) throw new Error("Browser session project does not match")
    const directories =
      directory === undefined ? projects : projects.filter((entry) => entry.route.directory === directory)
    if (directories.length === 0) throw new Error("Browser session directory does not match")
    if (directories.length !== 1) throw new Error("Browser session identity is ambiguous")
    return directories[0]
  }

  validate(target: string): URL {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw new Error("Browser URL is invalid")
    }
    if (!loopback(url) || url.username || url.password) {
      throw new Error(
        "Browser URLs must use HTTP localhost or 127.0.0.1 without credentials. Use localhost for IPv6 loopback servers.",
      )
    }
    return url
  }

  private allowed(entry: Entry, target: string, navigation = false): boolean {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return false
    }
    if (["about:", "blob:", "data:"].includes(url.protocol)) return !navigation
    if (url.protocol === "ws:" || url.protocol === "wss:")
      return `${url.protocol === "ws:" ? "http:" : "https:"}//${url.host}` === entry.origin
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return url.origin === entry.origin
  }

  private copy(state: BrowserState): BrowserState {
    return { ...state, logs: state.logs ? [...state.logs] : undefined }
  }

  private emit(state: BrowserState): void {
    if (state.status !== "closed") {
      if (this.closed) return
      const entry = this.entries.get(this.key(state.sessionId, state.projectId))
      if (!entry || entry.browserId !== state.browserId) return
    }
    const next = this.copy(state)
    for (const listener of this.listeners) listener(next)
  }

  private authorized(req: IncomingMessage): boolean {
    const value = req.headers.authorization
    if (typeof value !== "string") return false
    const actual = Buffer.from(value)
    const expected = Buffer.from(`Bearer ${this.token}`)
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
  }

  private status(req: IncomingMessage, res: ServerResponse, route: URL): boolean {
    if (req.method !== "GET" || route.pathname !== "/browser/status") return false
    json(res, 200, {
      enabled: !this.closed && this.opts.enabled?.() !== false && this.opts.trusted?.() !== false,
    })
    return true
  }

  private async operation(path: string, body: RequestBody & { sessionID: string; directory: string }) {
    const project = typeof body.projectID === "string" ? body.projectID : undefined
    if (path === "/browser/open") {
      if (typeof body.url !== "string") throw new Error("A local application URL is required")
      return this.open({ projectId: project, sessionId: body.sessionID, directory: body.directory }, body.url)
    }
    if (!["/browser/refresh", "/browser/close"].includes(path)) return undefined
    const entry = this.require(body.sessionID, body.directory, project)
    if (path === "/browser/refresh") return this.refresh(entry.route.sessionId, entry.route.projectId)
    await this.close(entry.route.sessionId, entry.route.projectId)
    return { sessionId: entry.route.sessionId, status: "closed" as const }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const route = new URL(req.url ?? "/", "http://127.0.0.1")
    if (this.tools && (await this.tools.handle(req, res, route))) return
    if (!this.authorized(req)) {
      json(res, 401, { error: "Unauthorized" })
      return
    }
    if (this.status(req, res, route)) return
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" })
      return
    }
    let body: RequestBody
    try {
      const value: unknown = JSON.parse(await read(req))
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object")
      body = value
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" })
      return
    }
    if (typeof body.sessionID !== "string" || typeof body.directory !== "string") {
      json(res, 400, { error: "sessionID and directory are required" })
      return
    }
    try {
      const result = await this.operation(route.pathname, {
        ...body,
        sessionID: body.sessionID,
        directory: body.directory,
      })
      if (!result) {
        json(res, 404, { error: "Unknown browser operation" })
        return
      }
      json(res, 200, result)
    } catch (error) {
      json(res, 400, { error: diagnostic(error, typeof body.url === "string" ? body.url : undefined) })
    }
  }
}
