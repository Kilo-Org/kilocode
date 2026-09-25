import type { Browser, CDPSession, Page } from "playwright-core"
import type { BrowserProxy } from "./browser-proxy"

type Command = Parameters<CDPSession["send"]>[0]
type Params = Parameters<CDPSession["send"]>[1]
type Send = (method: Command, params?: Params) => Promise<unknown>
type Deferred = ReturnType<typeof Promise.withResolvers<unknown>>
type Attachment = {
  sessionId: string
  targetInfo: { targetId: string; type: string; browserContextId?: string }
}
type Frame = { send: Send; pending: Map<number, Deferred>; parent?: string }
type Owner = {
  frames: ReadonlyMap<string, string | undefined>
  active: () => boolean
  request: (event: Request, send: Send) => Promise<void>
  authenticate: (event: Challenge, send: Send) => Promise<void>
  fail: () => void
}
type Paused = { owner: Owner; auth: boolean }

const guards = new WeakMap<Browser, Promise<Guard>>()

class Guard {
  private readonly owners = new Map<string, Owner>()
  private readonly pending = new Map<string, Paused>()
  private readonly send: Send = (method, params) =>
    this.session.send(method, params).catch((error: unknown) => {
      if (!(error instanceof Error && error.message.includes("Invalid InterceptionId"))) this.lost()
      throw error
    })
  private closed = false

  private constructor(
    private readonly browser: Browser,
    private readonly session: CDPSession,
  ) {
    session.on("Fetch.requestPaused", this.request)
    session.on("Fetch.authRequired", this.request)
    session.on("Inspector.detached", this.lost)
    browser.on("disconnected", this.lost)
  }

  static async acquire(browser: Browser): Promise<Guard> {
    const existing = guards.get(browser)
    if (existing) return existing
    const pending = (async () => {
      const session = await browser.newBrowserCDPSession()
      const guard = new Guard(browser, session)
      try {
        await session.send("Fetch.enable", {
          patterns: [{ urlPattern: "*", requestStage: "Request" }],
          handleAuthRequests: true,
        })
        return guard
      } catch (error) {
        guard.lost()
        throw error
      }
    })()
    guards.set(browser, pending)
    try {
      return await pending
    } catch (error) {
      if (guards.get(browser) === pending) guards.delete(browser)
      throw error
    }
  }

  bind(context: string, owner: Owner): () => Promise<void> {
    if (this.closed || this.owners.has(context)) throw new Error("Browser context network ownership is unavailable")
    this.owners.set(context, owner)
    return async () => {
      if (this.owners.get(context) === owner) this.owners.delete(context)
      await Promise.all(
        [...this.pending]
          .filter(([, paused]) => paused.owner === owner)
          .map(async ([id, paused]) => {
            this.pending.delete(id)
            await this.cancel(id, paused.auth)
          }),
      )
    }
  }

  private readonly request = (event: Request | Challenge) => {
    const auth = "authChallenge" in event
    const owner = [...this.owners.values()].find((owner) => owner.frames.has(event.frameId))
    if (this.closed || !owner?.active()) {
      void this.cancel(event.requestId, auth)
      return
    }
    const paused = { owner, auth }
    this.pending.set(event.requestId, paused)
    const operation = auth ? owner.authenticate(event, this.send) : owner.request(event, this.send)
    void operation
      .catch(() => this.lost())
      .finally(() => {
        if (this.pending.get(event.requestId) === paused) this.pending.delete(event.requestId)
      })
  }

  private async cancel(requestId: string, auth: boolean): Promise<void> {
    const operation = auth
      ? this.session.send("Fetch.continueWithAuth", { requestId, authChallengeResponse: { response: "CancelAuth" } })
      : this.session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
    await operation.catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("Invalid InterceptionId")) return
      this.lost()
    })
  }

  private readonly lost = () => {
    if (this.closed) return
    this.closed = true
    const pending = guards.get(this.browser)
    for (const owner of this.owners.values()) owner.fail()
    this.owners.clear()
    const requests = [...this.pending]
    this.pending.clear()
    void Promise.all(requests.map(([id, paused]) => this.cancel(id, paused.auth)))
      .then(() => this.session.detach())
      .catch(() => this.lost())
      .finally(() => {
        if (guards.get(this.browser) === pending) guards.delete(this.browser)
        this.session.off("Fetch.requestPaused", this.request)
        this.session.off("Fetch.authRequired", this.request)
        this.session.off("Inspector.detached", this.lost)
        this.browser.off("disconnected", this.lost)
      })
  }
}

interface Request {
  requestId: string
  frameId: string
  resourceType: string
  request: { url: string }
}

interface Challenge {
  requestId: string
  frameId: string
  authChallenge: { source?: string; origin: string; realm: string; scheme: string }
}

interface Options {
  url: URL
  proxy: BrowserProxy
  approve: (url: URL) => Promise<boolean>
  blocked: (message: string) => void
  log: (...args: unknown[]) => void
}

export class BrowserNetwork {
  private readonly origins = new Set<string>()
  private readonly challenges = new Set<string>()
  private readonly approvals = new Map<string, Promise<boolean>>()
  private readonly frames = new Map<string, Frame>()
  private readonly documents = new Map<string, string | undefined>()
  private readonly send: Send = (method, params) => this.session.send(method, params)
  private release: (() => Promise<void>) | undefined
  private stopping: Promise<void> | undefined
  private sequence = 0
  private root = ""
  private closed = false
  private failed = false

  get active(): boolean {
    return !this.closed && !this.failed
  }

  private constructor(
    private readonly page: Page,
    private readonly session: CDPSession,
    private readonly opts: Options,
  ) {
    this.origins.add(opts.url.origin)
  }

  static async attach(page: Page, opts: Options): Promise<BrowserNetwork> {
    const session = await page.context().newCDPSession(page)
    const network = new BrowserNetwork(page, session, opts)
    session.on("Page.frameNavigated", network.navigated)
    session.on("Page.frameAttached", network.inserted)
    session.on("Page.frameDetached", network.removed)
    session.on("Inspector.detached", network.lost)
    session.on("Target.attachedToTarget", network.attached)
    session.on("Target.receivedMessageFromTarget", network.received)
    session.on("Target.detachedFromTarget", network.detached)
    try {
      const browser = page.context().browser()
      if (!browser) throw new Error("Browser network ownership requires a browser connection")
      const { targetInfo: target } = await session.send("Target.getTargetInfo")
      if (!target.browserContextId) throw new Error("Browser network ownership requires an isolated context")
      await session.send("Page.enable")
      const tree = await session.send("Page.getFrameTree")
      network.root = tree.frameTree.frame.id
      network.documents.set(network.root, undefined)
      const guard = await Guard.acquire(browser)
      network.release = guard.bind(target.browserContextId, {
        frames: network.documents,
        active: () => network.active,
        request: network.request,
        authenticate: network.authenticate,
        fail: network.lost,
      })
      await network.enable(network.send)
      return network
    } catch (error) {
      await network.close()
      throw error
    }
  }

  authorize(url: URL): void {
    this.origins.add(url.origin)
  }

  private async enable(send: Send): Promise<void> {
    await send("Page.enable")
    await send("Network.setCacheDisabled", { cacheDisabled: true })
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
      filter: [{ type: "iframe" }],
    })
  }

  private readonly attached = (event: Attachment, parent?: string) => {
    const pending = new Map<number, Deferred>()
    const upstream = parent ? this.frames.get(parent)?.send : this.send
    if (!upstream) return this.lost()
    const send: Send = (method, params) => {
      const deferred = Promise.withResolvers<unknown>()
      const id = ++this.sequence
      pending.set(id, deferred)
      void upstream("Target.sendMessageToTarget", {
        sessionId: event.sessionId,
        message: JSON.stringify({ id, method, params }),
      }).catch(deferred.reject)
      return deferred.promise.finally(() => pending.delete(id))
    }
    this.frames.set(event.sessionId, { send, pending, parent })
    void (async () => {
      if (!this.active || event.targetInfo.type !== "iframe") throw new Error("Browser frame is not available")
      await this.enable(send)
      await send("Runtime.runIfWaitingForDebugger")
    })().catch((error: unknown) => {
      if (!this.active || !this.frames.has(event.sessionId)) return
      this.opts.log("Browser frame network controls failed", error)
      this.lost()
    })
  }

  private readonly received = (event: { sessionId: string; message: string }) => {
    const frame = this.frames.get(event.sessionId)
    if (!frame) return
    const message = JSON.parse(event.message) as {
      id?: number
      result?: unknown
      error?: { message: string }
      method?: string
      params: unknown
    }
    if (message.id !== undefined) {
      const deferred = frame.pending.get(message.id)
      if (message.error) return deferred?.reject(new Error(message.error.message))
      deferred?.resolve(message.result)
      return
    }
    if (message.method === "Page.frameAttached")
      this.inserted(message.params as { frameId: string; parentFrameId: string })
    if (message.method === "Page.frameDetached") this.removed(message.params as { frameId: string; reason: string })
    if (message.method === "Inspector.detached") this.lost()
    if (message.method === "Target.attachedToTarget") this.attached(message.params as Attachment, event.sessionId)
    if (message.method === "Target.receivedMessageFromTarget") {
      this.received(message.params as { sessionId: string; message: string })
    }
    if (message.method === "Target.detachedFromTarget") this.detached(message.params as { sessionId: string })
  }

  private readonly detached = (event: { sessionId: string }) => {
    const frame = this.frames.get(event.sessionId)
    if (!frame) return
    this.frames.delete(event.sessionId)
    for (const deferred of frame.pending.values()) deferred.reject(new Error("Browser frame was detached"))
    for (const [id, child] of this.frames) {
      if (child.parent === event.sessionId) this.detached({ sessionId: id })
    }
  }

  private readonly inserted = (event: { frameId: string; parentFrameId: string }) => {
    if (this.documents.has(event.parentFrameId)) this.documents.set(event.frameId, event.parentFrameId)
  }

  private readonly removed = (event: { frameId: string; reason: string }) => {
    if (event.reason !== "remove") return
    this.documents.delete(event.frameId)
    for (const [frameId, parent] of this.documents) {
      if (parent === event.frameId) this.removed({ frameId, reason: "remove" })
    }
  }

  private readonly navigated = (event: { frame: { id: string; parentId?: string } }) => {
    if (event.frame.parentId) return
    if (this.root !== event.frame.id) this.removed({ frameId: this.root, reason: "remove" })
    this.root = event.frame.id
    this.documents.set(this.root, undefined)
  }

  private readonly lost = () => {
    if (!this.active) return
    this.failed = true
    this.opts.blocked("Browser network controls disconnected. Close and reopen the browser.")
    void this.opts.proxy.close().catch((error: unknown) => this.opts.log("Browser proxy close failed", error))
  }

  private readonly authenticate = async (event: Challenge, send: Send): Promise<void> => {
    const credentials = this.opts.proxy.credentials
    const challenge = event.authChallenge
    const allowed =
      this.active &&
      !this.challenges.has(event.requestId) &&
      challenge.source === "Proxy" &&
      challenge.origin === credentials.origin &&
      challenge.realm === credentials.realm &&
      challenge.scheme.toLowerCase() === "basic"
    this.challenges.add(event.requestId)
    if (this.challenges.size > 256) {
      const first = this.challenges.values().next().value
      if (first) this.challenges.delete(first)
    }
    await send("Fetch.continueWithAuth", {
      requestId: event.requestId,
      authChallengeResponse: allowed
        ? { response: "ProvideCredentials", username: credentials.username, password: credentials.password }
        : { response: "CancelAuth" },
    }).catch((error: unknown) => {
      if (!this.closed) this.opts.log("Browser proxy authentication ended", error)
    })
  }

  private readonly request = (event: Request, send: Send) => {
    return this.continue(event, send).catch(async (error: unknown) => {
      if (!this.closed) this.opts.log("Browser request policy failed", error)
      await this.reject(event.requestId, send)
    })
  }

  private async continue(event: Request, send: Send): Promise<void> {
    if (!this.active) return this.reject(event.requestId, send)
    const url = URL.parse(event.request.url)
    if (!url || url.username || url.password) return this.reject(event.requestId, send)
    if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") {
      if (event.resourceType === "Document" && event.frameId === this.root) return this.reject(event.requestId, send)
      return this.resume(event.requestId, send)
    }
    if (!this.allowed(url, event.resourceType === "Document")) {
      if (event.resourceType === "Document" && event.frameId === this.root) {
        this.opts.blocked(
          this.opts.url.protocol === "http:"
            ? "Local browser navigation must stay on the approved origin."
            : "Remote browser pages must use public HTTPS.",
        )
      }
      return this.reject(event.requestId, send)
    }
    if (event.resourceType !== "Document" || event.frameId !== this.root || this.origins.has(url.origin)) {
      return this.resume(event.requestId, send)
    }
    const approval = this.approvals.get(url.origin) ?? this.opts.approve(url)
    this.approvals.set(url.origin, approval)
    const allowed = await approval.finally(() => {
      if (this.approvals.get(url.origin) === approval) this.approvals.delete(url.origin)
    })
    if (!this.active) return this.reject(event.requestId, send)
    if (!allowed) {
      this.opts.blocked(`Navigation to ${url.origin} was not approved.`)
      return this.reject(event.requestId, send)
    }
    this.origins.add(url.origin)
    return this.resume(event.requestId, send)
  }

  private allowed(url: URL, document: boolean): boolean {
    if (this.opts.url.protocol !== "http:") return url.protocol === "https:" || url.protocol === "wss:"
    const origin = url.protocol === "ws:" ? `http://${url.host}` : url.origin
    if (["http:", "ws:"].includes(url.protocol) && origin === this.opts.url.origin) return true
    return !document && ["https:", "wss:"].includes(url.protocol)
  }

  private async resume(requestId: string, send: Send): Promise<void> {
    if (!this.active) return this.reject(requestId, send)
    await send("Fetch.continueRequest", { requestId })
  }

  private async reject(requestId: string, send: Send): Promise<void> {
    await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch((error: unknown) => {
      if (!this.closed) this.opts.log("Browser request already ended", error)
    })
  }

  close(): Promise<void> {
    return (this.stopping ??= this.stop())
  }

  private async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.opts.proxy.close().catch((error: unknown) => this.opts.log("Browser proxy close failed", error))
    this.approvals.clear()
    this.challenges.clear()
    this.session.off("Page.frameNavigated", this.navigated)
    this.session.off("Page.frameAttached", this.inserted)
    this.session.off("Page.frameDetached", this.removed)
    this.documents.clear()
    await this.release?.()
    this.release = undefined
    this.session.off("Inspector.detached", this.lost)
    this.session.off("Target.attachedToTarget", this.attached)
    this.session.off("Target.receivedMessageFromTarget", this.received)
    this.session.off("Target.detachedFromTarget", this.detached)
    for (const sessionId of this.frames.keys()) this.detached({ sessionId })
    if (this.page.isClosed()) return
    await this.session
      .send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: false })
      .catch((error: unknown) => {
        if (!this.page.isClosed()) this.opts.log("Browser frame network controls ended", error)
      })
    if (this.page.isClosed()) return
    await this.session.detach().catch((error: unknown) => {
      if (!this.page.isClosed()) this.opts.log("Browser network session ended", error)
    })
  }
}
