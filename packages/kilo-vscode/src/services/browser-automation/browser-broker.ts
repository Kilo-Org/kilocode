import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { URL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "playwright-core"
import { BrowserDevtools } from "./browser-devtools"
import { capture as element, locate } from "./browser-element"
import { options } from "./browser-runtime"
import { BrowserStream } from "./browser-stream"
import { BrowserNetwork } from "./browser-network"
import { BrowserProxy } from "./browser-proxy"
import { parse } from "./browser-policy"
import type {
  BrowserFrame,
  BrowserInteraction,
  BrowserViewport,
  BrowserViewIdentity,
} from "../../shared/browser-stream"

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
  missing?: "chrome" | "chromium"
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
  network?: (
    page: Page,
    options: Parameters<typeof BrowserNetwork.attach>[1],
  ) => Promise<Pick<BrowserNetwork, "authorize" | "close" | "active">>
}

export interface BrowserContextFactory {
  debugging?: number
  newContext(options: BrowserContextOptions): Promise<BrowserContext>
  close(): Promise<void>
}

interface Entry {
  route: BrowserRoute
  browserId: string
  context: BrowserContext
  page: Page
  proxy: BrowserProxy
  network?: Pick<BrowserNetwork, "authorize" | "close" | "active">
  waiting: Set<string>
  local: boolean
  origin: string
  state: BrowserState
  response?: number
  stream?: BrowserStream
  viewport?: BrowserViewport
  navigating?: boolean
}

export class BrowserLaunchError extends Error {
  constructor(
    readonly missing: "chrome" | "chromium" | undefined,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(
      missing === "chrome"
        ? "Google Chrome was not found. Install Chrome and try again."
        : missing === "chromium"
          ? "A compatible Playwright Chromium browser was not found. Install one or enable Use System Chrome in Kilo Settings > Web Tools."
          : `The browser could not start. ${detail}`,
      { cause },
    )
    this.name = "BrowserLaunchError"
  }
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
const TIMEOUT = /ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|Timeout \d+ms exceeded/i

export function diagnostic(error: unknown, url?: string): string {
  const text = stripVTControlCharacters(error instanceof Error ? error.message : String(error))
  const launch = error instanceof BrowserLaunchError
  if (!launch && /ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) {
    return `Cannot connect to ${url ?? "the local application"}. Make sure the local server is running.`
  }
  if (!launch && TIMEOUT.test(text)) {
    return url && URL.parse(url)?.protocol === "https:"
      ? "The website did not respond in time. Check the URL and network connection, then try again."
      : "The local application did not respond in time. Check the server and try again."
  }
  if (!launch && /Target page, context or browser has been closed|Browser has been closed/i.test(text)) {
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
  private readonly viewers = new Set<(frame: BrowserFrame & Pick<BrowserRoute, "sessionId" | "projectId">) => void>()
  private readonly token = randomBytes(32).toString("hex")
  private readonly proxies = new Set<BrowserProxy>()
  private gateway: BrowserProxy | undefined
  private owner: ((route: BrowserRoute) => BrowserRoute | undefined) | undefined
  private approval: ((route: BrowserRoute, url: URL) => Promise<boolean>) | undefined
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

  bind(
    owner: (route: BrowserRoute) => BrowserRoute | undefined,
    approve?: (route: BrowserRoute, url: URL) => Promise<boolean>,
  ): void {
    this.owner = owner
    this.approval = approve
  }

  subscribe(listener: (state: BrowserState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  replay(listener: (state: BrowserState) => void): void {
    for (const entry of this.entries.values()) listener(this.copy(entry.state))
  }

  frames(listener: (frame: BrowserFrame & Pick<BrowserRoute, "sessionId" | "projectId">) => void): () => void {
    this.viewers.add(listener)
    return () => this.viewers.delete(listener)
  }

  async viewport(
    sessionId: string,
    projectId: string | undefined,
    browserId: string,
    navigation: number,
    viewport: BrowserViewport,
  ): Promise<void> {
    this.available()
    const entry = this.view(sessionId, projectId, { browserId, navigation })
    if (!entry || !Number.isSafeInteger(viewport.revision) || viewport.revision < 1) return
    if (entry.viewport && viewport.revision < entry.viewport.revision) return
    if (!entry.stream) {
      entry.stream = new BrowserStream(
        entry.page,
        () => ({ browserId: entry.browserId, navigation: entry.state.navigation }),
        (frame) => {
          if (!this.view(sessionId, projectId, frame) || entry.viewport?.active !== true) return
          for (const viewer of this.viewers) viewer({ ...frame, projectId, sessionId })
        },
        this.opts.log,
      )
    }
    entry.viewport = { ...viewport }
    await entry.stream.configure(viewport)
  }

  accepts(sessionId: string, projectId: string | undefined, identity: BrowserViewIdentity): boolean {
    const entry = this.view(sessionId, projectId, identity)
    return !!entry?.stream && entry.viewport?.active === true && entry.viewport.revision === identity.revision
  }

  acknowledge(sessionId: string, projectId: string | undefined, identity: BrowserViewIdentity, sequence: number): void {
    const entry = this.view(sessionId, projectId, identity)
    if (entry?.viewport?.revision !== identity.revision) return
    if (Number.isSafeInteger(sequence) && sequence > 0) entry.stream?.acknowledge(sequence)
  }

  async interact(
    sessionId: string,
    projectId: string | undefined,
    identity: BrowserViewIdentity,
    event: BrowserInteraction,
    read?: () => Promise<string>,
    write?: (text: string) => void | Promise<void>,
  ): Promise<string | undefined> {
    if (!this.accepts(sessionId, projectId, identity)) return
    const entry = this.view(sessionId, projectId, identity)
    if (!entry?.stream) return
    const copied = await entry.stream.interact(
      event,
      read,
      write &&
        ((text) => {
          if (this.view(sessionId, projectId, identity)) return write(text)
        }),
    )
    return this.view(sessionId, projectId, identity) ? copied : undefined
  }

  suspend(): void {
    for (const entry of this.entries.values()) {
      if (!entry.viewport || !entry.stream) continue
      entry.viewport = { ...entry.viewport, active: false }
      void entry.stream
        .configure(entry.viewport)
        .catch((error: unknown) => this.opts.log("Browser stream pause failed", error))
    }
  }

  private view(
    sessionId: string,
    projectId: string | undefined,
    identity: Pick<BrowserViewIdentity, "browserId" | "navigation">,
  ): Entry | undefined {
    if (this.closed || this.opts.enabled?.() === false || this.opts.trusted?.() === false) return
    const entry = this.entries.get(this.key(sessionId, projectId))
    if (!entry || entry.browserId !== identity.browserId || entry.state.navigation !== identity.navigation) return
    const scope = this.owner ? this.owner(entry.route) : entry.route
    return scope?.directory === entry.route.directory && scope.projectId === entry.route.projectId ? entry : undefined
  }

  get(sessionId: string, projectId?: string): BrowserState | undefined {
    const entries = [...this.entries.values()].filter(
      (entry) =>
        entry.route.sessionId === sessionId && (projectId === undefined || entry.route.projectId === projectId),
    )
    return entries.length === 1 ? this.copy(entries[0].state) : undefined
  }

  sessions(): string[] {
    return [...new Set([...this.entries.keys(), ...this.pending.keys()].map((key) => key.slice(key.indexOf("\0") + 1)))]
  }

  open(route: BrowserRoute, target: string, capture = true): Promise<BrowserState> {
    const scope = this.owner ? this.owner(route) : route
    if (!scope)
      return Promise.reject(new Error("Browser session does not belong to the requested project or directory"))
    return this.serial(this.key(scope.sessionId, scope.projectId), () => this.create(scope, target, capture))
  }

  private async create(scope: BrowserRoute, target: string, capture: boolean): Promise<BrowserState> {
    this.available()
    const url = this.validate(target)
    const existing = this.entries.get(this.key(scope.sessionId, scope.projectId))
    if (existing) {
      if (existing.route.directory !== scope.directory) throw new Error("Browser session directory cannot change")
      if (existing.route.projectId !== scope.projectId) {
        throw new Error("Browser session project cannot change")
      }
      const replace =
        existing.network?.active === false ||
        existing.local !== (url.protocol === "http:") ||
        (existing.local && existing.origin !== url.origin)
      if (!replace) {
        existing.route.projectId = scope.projectId ?? existing.route.projectId
        existing.state.projectId = existing.route.projectId
        existing.network?.authorize(url)
        const reload = existing.state.status === "ready" && existing.page.url() === url.href
        await this.goto(existing, url, reload, capture)
        return this.copy(existing.state)
      }
      await this.retire(existing)
    }

    const browser = await this.ensureBrowser()
    this.available()
    const proxy = await BrowserProxy.start(url.protocol === "http:" ? url : "public")
    this.proxies.add(proxy)
    const context = await (async () => {
      this.available()
      return browser.newContext({
        serviceWorkers: "block",
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
        proxy: proxy.proxy,
        ignoreHTTPSErrors: false,
        acceptDownloads: false,
      })
    })().catch(async (error: unknown) => {
      await proxy.close()
      this.proxies.delete(proxy)
      throw error
    })
    const page = await context.newPage().catch(async (error: unknown) => {
      await proxy.close()
      this.proxies.delete(proxy)
      await context.close().catch((failure: unknown) => this.opts.log("Browser context close failed", failure))
      throw error
    })
    const entry: Entry = {
      route: { ...scope },
      browserId: randomUUID(),
      context,
      page,
      proxy,
      waiting: new Set(),
      local: url.protocol === "http:",
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
    try {
      this.available()
      if (this.owner && !this.owner(scope)) throw new Error("Browser session is no longer available")
      entry.network = await (this.opts.network ?? BrowserNetwork.attach)(page, {
        url,
        proxy,
        approve: async (target) => {
          const identity = { browserId: entry.browserId, navigation: entry.state.navigation }
          if (!this.view(scope.sessionId, scope.projectId, identity)) return false
          entry.waiting.add(target.origin)
          try {
            const approved = await this.approval?.(entry.route, target)
            return (
              approved === true &&
              entry.network?.active !== false &&
              !!this.view(scope.sessionId, scope.projectId, identity)
            )
          } finally {
            entry.waiting.delete(target.origin)
          }
        },
        blocked: (message) => {
          entry.state.error = message
          this.emit(entry.state)
        },
        log: this.opts.log,
      })
      this.available()
      if (this.owner && !this.owner(scope)) throw new Error("Browser session is no longer available")
    } catch (error) {
      await this.retire(entry)
      throw error
    }
    this.emit(entry.state)
    await this.goto(entry, url, false, capture)
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

  refresh(sessionId: string, projectId?: string, capture = true): Promise<BrowserState> {
    return this.serial(this.key(sessionId, projectId), async () => {
      this.available()
      const entry = this.require(sessionId, undefined, projectId)
      const url = this.validate(entry.state.url ?? entry.origin)
      await this.goto(entry, url, true, capture)
      return this.copy(entry.state)
    })
  }

  close(sessionId: string, projectId?: string): Promise<void> {
    const keys = new Set([...this.entries.keys(), ...this.pending.keys()])
    return Promise.all(
      [...keys]
        .filter((key) =>
          projectId === undefined
            ? key.slice(key.indexOf("\0") + 1) === sessionId
            : key === this.key(sessionId, projectId),
        )
        .map((key) => this.stop(key)),
    ).then(() => undefined)
  }

  private stop(key: string): Promise<void> {
    const entry = this.entries.get(key)
    void entry?.proxy.close().catch((error: unknown) => this.opts.log("Browser proxy close failed", error))
    return this.serial(key, async () => {
      const current = this.entries.get(key)
      if (current) await this.retire(current)
    })
  }

  private async retire(entry: Entry): Promise<void> {
    const key = this.key(entry.route.sessionId, entry.route.projectId)
    if (this.entries.get(key) === entry) this.entries.delete(key)
    this.tools?.revoke(entry.browserId)
    const stream = entry.stream?.close().catch((error: unknown) => this.opts.log("Browser stream close failed", error))
    const network = entry.network
      ?.close()
      .catch((error: unknown) => this.opts.log("Browser network close failed", error))
    await entry.proxy.close().catch((error: unknown) => this.opts.log("Browser proxy close failed", error))
    this.proxies.delete(entry.proxy)
    await entry.context.close().catch((error: unknown) => this.opts.log("Browser context close failed", error))
    await Promise.all([stream, network])
    entry.state.status = "closed"
    entry.state.screenshot = undefined
    this.emit(entry.state)
  }

  async disposeAsync(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.proxies].map((proxy) => proxy.close()))
    await Promise.all([...new Set([...this.entries.keys(), ...this.pending.keys()])].map((key) => this.stop(key)))
    this.proxies.clear()
    this.gateway = undefined
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
    this.viewers.clear()
  }

  dispose(): void {
    void this.disposeAsync().catch((error: unknown) => this.opts.log("Browser broker dispose failed", error))
  }

  private async ensureBrowser(): Promise<BrowserContextFactory> {
    if (this.closed) throw new Error("Browser broker is closed")
    if (this.browser) return this.browser
    if (this.browserStarting) return this.browserStarting
    const system = this.opts.useSystemChrome?.() !== false
    this.browserStarting = (async () => {
      const port = this.opts.launch ? undefined : await reserve()
      const base = options(system, port)
      const gateway = await BrowserProxy.start("deny")
      this.proxies.add(gateway)
      this.gateway = gateway
      this.available()
      const config: LaunchOptions = {
        ...base,
        proxy: gateway.proxy,
        ignoreDefaultArgs: ["--disable-popup-blocking"],
        args: [
          ...(base.args ?? []).filter((arg) => arg !== "--no-proxy-server"),
          "--force-device-scale-factor=2",
          "--disable-quic",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          "--webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      }
      const browser = await (this.opts.launch?.(config) ?? chromium.launch(config))
      this.debugging = ("debugging" in browser ? browser.debugging : undefined) ?? port
      this.browser = browser
      return browser
    })()
    try {
      return await this.browserStarting
    } catch (error) {
      const gateway = this.gateway
      this.gateway = undefined
      if (gateway) {
        await gateway.close().catch((failure: unknown) => this.opts.log("Browser proxy close failed", failure))
        this.proxies.delete(gateway)
      }
      const detail = error instanceof Error ? error.message : String(error)
      const missing = /Chromium distribution ['"]chrome['"] is not found\b|Executable doesn't exist at\b/i.test(detail)
        ? system
          ? "chrome"
          : "chromium"
        : undefined
      throw new BrowserLaunchError(missing, error)
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
      if (!entry.navigating) entry.state.navigation++
      void this.update(entry)
        .then(() => this.emit(entry.state))
        .catch((error: unknown) => this.fail(entry, error))
    })
    entry.page.on("domcontentloaded", () => {
      void this.update(entry)
        .then(() => this.emit(entry.state))
        .catch((error: unknown) => this.fail(entry, error))
    })
  }

  private async goto(entry: Entry, url: URL, reload = false, capture = true): Promise<void> {
    entry.navigating = true
    entry.origin = url.origin
    entry.response = undefined
    entry.state.navigation++
    entry.state.status = "loading"
    entry.state.url = url.href
    entry.state.title = undefined
    entry.state.screenshot = undefined
    entry.state.mime = undefined
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
      if (entry.response !== undefined && entry.response >= 400) {
        await this.update(entry)
        if (capture) await this.capture(entry)
        throw new BrowserNavigationError(`Local application returned HTTP ${entry.response}`, entry.response)
      }
      await this.update(entry)
      if (capture) await this.capture(entry)
      entry.state.status = "ready"
      this.emit(entry.state)
    } catch (error) {
      const waiting = entry.waiting.size > 0 && TIMEOUT.test(error instanceof Error ? error.message : String(error))
      const failure = waiting
        ? new BrowserNavigationError(
            "Browser navigation stopped while waiting for approval in VS Code. Dismiss the approval prompt and retry.",
          )
        : error
      if (waiting)
        await entry.network?.close().catch((error: unknown) => this.opts.log("Browser network close failed", error))
      entry.state.url = url.href
      this.fail(entry, failure)
      throw failure
    } finally {
      entry.navigating = false
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
    const viewport = entry.page.viewportSize?.()
    const width = entry.viewport && viewport ? viewport.width : Math.max(1, Math.min(1920, Math.round(position.width)))
    const height =
      entry.viewport && viewport ? viewport.height : Math.max(1, Math.min(1440, Math.round(position.height)))
    if (viewport?.width !== width || viewport.height !== height) {
      await entry.page.setViewportSize({ width, height })
    }
    return { x: position.x * width, y: position.y * height }
  }

  private async update(entry: Entry): Promise<void> {
    const navigation = entry.state.navigation
    const url = entry.page.url()
    const parsed = URL.parse(url)
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return
    const title = await entry.page.title().catch(() => undefined)
    if (entry.state.navigation !== navigation || entry.page.url() !== url) return
    entry.state.url = url
    entry.state.title = title
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
    return parse(target)
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
