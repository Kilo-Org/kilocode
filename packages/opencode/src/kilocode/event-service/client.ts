/**
 * Generic Event Service WebSocket client.
 *
 * Connects via a two-step ticket flow:
 *   1. POST `/connect-ticket` with `Authorization: Bearer <JWT>` to mint a
 *      single-use ticket (30 s TTL).
 *   2. Open WebSocket to `/connect?ticket=<ticket>` with subprotocol
 *      `kilo.events.v1`.
 *
 * Uses the global `WebSocket` constructor (Bun, Node 22+, browsers).
 *
 * Disconnect invalidation: every `connect()` and `disconnect()` bumps a
 * generation counter. `connectOnce()` captures the generation at entry and,
 * after the ticket mint resolves, refuses to construct a socket if the
 * generation changed or the client was disposed. `disconnect()` also aborts
 * an in-flight ticket request and the pending handshake, so a ticket response
 * arriving after disposal can never create a socket.
 */

const WS_SUBPROTOCOL = "kilo.events.v1"
const HANDSHAKE_TIMEOUT_MS = 10_000
const PING_INTERVAL_MS = 15_000
const TICKET_FETCH_TIMEOUT_MS = 10_000

export class WebSocketAuthError extends Error {
  constructor(message = "WebSocket authentication failed") {
    super(message)
    this.name = "WebSocketAuthError"
  }
}

export class WebSocketConnectError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message)
    this.name = "WebSocketConnectError"
  }
}

export class HandshakeTimeoutError extends Error {
  constructor() {
    super("WebSocket handshake timed out")
    this.name = "HandshakeTimeoutError"
  }
}

function isAuthCloseCode(code: number): boolean {
  if (code === 1008) return true
  if (code === 4401 || code === 4403) return true
  return false
}

export type EventHandler = (context: string, payload: unknown) => void

export type EventServiceConfig = {
  url: string
  getToken: () => Promise<string>
  onUnauthorized?: () => void
  onServerError?: (error: unknown) => void
  handshakeTimeoutMs?: number
}

function toHttpBase(wsBase: string): string {
  const trimmed = wsBase.replace(/\/$/, "")
  if (trimmed.startsWith("wss://")) return "https://" + trimmed.slice(6)
  if (trimmed.startsWith("ws://")) return "http://" + trimmed.slice(5)
  return trimmed
}

export class EventServiceClient {
  private readonly url: string
  private readonly getToken: () => Promise<string>
  private readonly onUnauthorized: (() => void) | undefined
  private readonly onServerError: ((error: unknown) => void) | undefined
  private readonly handshakeTimeoutMs: number

  private ws: WebSocket | null = null
  private connected = false
  private destroyed = false
  private generation = 0
  private reconnectAttempts = 0
  private hasConnectedBefore = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private abortHandshake: ((err: Error) => void) | null = null
  private tickets = new Set<AbortController>()

  private eventHandlers = new Map<string, Set<EventHandler>>()
  private activeContexts = new Set<string>()
  private reconnectHandlers = new Set<() => void>()

  constructor(config: EventServiceConfig) {
    this.url = config.url
    this.getToken = config.getToken
    this.onUnauthorized = config.onUnauthorized
    this.onServerError = config.onServerError
    this.handshakeTimeoutMs = config.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
  }

  async connect(): Promise<void> {
    const gen = ++this.generation
    this.destroyed = false
    this.reconnectAttempts = 0
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      await this.connectOnce()
    } catch (err) {
      if (this.destroyed || this.generation !== gen) return
      if (this.handleAuthFailure(err)) return
      if (!this.destroyed) this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.generation++
    this.destroyed = true
    for (const ctrl of this.tickets) ctrl.abort()
    this.tickets.clear()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearHandshakeTimer()
    if (this.abortHandshake) {
      this.abortHandshake(new Error("disconnected"))
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.stopPing()
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  subscribe(contexts: string[]): void {
    for (const ctx of contexts) this.activeContexts.add(ctx)
    if (this.isConnected()) {
      this.sendJson({ type: "context.subscribe", contexts })
    }
  }

  unsubscribe(contexts: string[]): void {
    for (const ctx of contexts) this.activeContexts.delete(ctx)
    if (this.isConnected()) {
      this.sendJson({ type: "context.unsubscribe", contexts })
    }
  }

  on<T = unknown>(event: string, handler: (context: string, payload: T) => void): () => void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>()
    const wrapped: EventHandler = (ctx, payload) => handler(ctx, payload as T)
    set.add(wrapped)
    this.eventHandlers.set(event, set)
    return () => {
      set.delete(wrapped)
      if (set.size === 0) this.eventHandlers.delete(event)
    }
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler)
    return () => this.reconnectHandlers.delete(handler)
  }

  // ── private ────────────────────────────────────────────────────────

  private handleAuthFailure(err: unknown): boolean {
    if (err instanceof WebSocketAuthError) {
      this.destroyed = true
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.onUnauthorized?.()
      return true
    }
    return false
  }

  private async connectOnce(): Promise<void> {
    const gen = this.generation
    if (this.ws) {
      const old = this.ws
      this.ws = null
      old.close()
    }

    const token = await this.getToken()
    if (this.destroyed || this.generation !== gen) return
    const ticket = await this.fetchTicket(token)
    if (this.destroyed || this.generation !== gen) return

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${this.url}/connect?ticket=${encodeURIComponent(ticket)}`, [WS_SUBPROTOCOL])
      this.ws = ws

      let settled = false
      const settleResolve = () => {
        if (settled) return
        settled = true
        this.clearHandshakeTimer()
        this.abortHandshake = null
        resolve()
      }
      const settleReject = (err: Error) => {
        if (settled) return
        settled = true
        this.clearHandshakeTimer()
        this.abortHandshake = null
        reject(err)
      }
      this.abortHandshake = settleReject

      this.handshakeTimer = setTimeout(() => {
        this.handshakeTimer = null
        if (this.ws === ws) ws.close(1000, "handshake-timeout")
        settleReject(new HandshakeTimeoutError())
      }, this.handshakeTimeoutMs)

      ws.addEventListener("open", () => {
        if (this.ws !== ws) return
        const isReconnect = this.hasConnectedBefore
        this.connected = true
        this.hasConnectedBefore = true
        this.reconnectAttempts = 0
        this.resubscribeContexts()
        if (isReconnect) {
          for (const h of this.reconnectHandlers) h()
        }
        settleResolve()
        this.startPing()
      })

      ws.addEventListener("message", (event: MessageEvent) => {
        if (this.ws !== ws) return
        this.handleMessage(String(event.data))
      })

      ws.addEventListener("close", (event: CloseEvent) => {
        if (this.ws !== ws) return
        const wasConnected = this.connected
        this.connected = false
        this.stopPing()
        this.clearHandshakeTimer()
        if (!wasConnected) {
          if (isAuthCloseCode(event.code)) {
            settleReject(new WebSocketAuthError())
          } else {
            settleReject(
              new WebSocketConnectError(`WebSocket closed before open: ${event.code} ${event.reason}`, event.code),
            )
          }
          return
        }
        if (!this.destroyed) this.scheduleReconnect()
      })

      ws.addEventListener("error", () => {})
    })
  }

  private async fetchTicket(token: string): Promise<string> {
    const ctrl = new AbortController()
    this.tickets.add(ctrl)
    const timer = setTimeout(() => ctrl.abort(), TICKET_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(toHttpBase(this.url) + "/connect-ticket", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      })
      if (res.status === 401 || res.status === 403) {
        throw new WebSocketAuthError(`Event-service rejected ticket request: ${res.status}`)
      }
      if (!res.ok) {
        throw new WebSocketConnectError(`Failed to mint event-service ticket: ${res.status}`, res.status)
      }
      const body = (await res.json().catch(() => null)) as { ticket?: unknown } | null
      if (!body || typeof body.ticket !== "string" || !body.ticket) {
        throw new WebSocketConnectError("Malformed event-service ticket response", 0)
      }
      return body.ticket
    } catch (err) {
      if (err instanceof WebSocketAuthError || err instanceof WebSocketConnectError) throw err
      if ((err as { name?: string })?.name === "AbortError") {
        throw new HandshakeTimeoutError()
      }
      throw new WebSocketConnectError(`Event-service ticket request failed: ${(err as Error)?.message ?? err}`, 0)
    } finally {
      clearTimeout(timer)
      this.tickets.delete(ctrl)
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  private sendJson(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private handleMessage(data: string): void {
    if (data === "pong") return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== "object") return
    const m = parsed as Record<string, unknown>
    if (m.type === "event" && typeof m.context === "string" && typeof m.event === "string") {
      const handlers = this.eventHandlers.get(m.event)
      if (handlers) {
        for (const h of handlers) h(m.context, m.payload)
      }
      return
    }
    if (m.type === "error") {
      console.warn("[Kilo] event-service server error", m)
      this.onServerError?.(m)
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("ping")
      }
    }, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private resubscribeContexts(): void {
    if (this.activeContexts.size > 0) {
      this.sendJson({
        type: "context.subscribe",
        contexts: Array.from(this.activeContexts),
      })
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    const base = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts)
    const delay = base * (0.5 + Math.random() * 0.5)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.destroyed) return
      const gen = this.generation
      this.connectOnce().catch((err) => {
        if (this.destroyed || this.generation !== gen) return
        if (this.handleAuthFailure(err)) return
        if (!this.destroyed) this.scheduleReconnect()
      })
    }, delay)
  }
}
