// kilocode_change - new file

/**
 * Event Service WebSocket client for the TUI.
 *
 * Minimal inline port of `@kilocode/event-service` (cloud monorepo).
 * Authenticates with a JWT carried in the `kilo.jwt.<base64url>`
 * subprotocol header, subscribes to per-context paths, and dispatches
 * server events to typed handlers.
 *
 * Uses the global `WebSocket` constructor (Bun, Node 22+, browsers).
 */

import type { KiloChatEventMap, KiloChatEventName } from "./types"

const SUBPROTOCOL_PREFIX = "kilo.jwt."
const HANDSHAKE_TIMEOUT_MS = 10_000
const PING_INTERVAL_MS = 15_000

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

// Close codes that signal the server rejected us for auth/policy reasons
// and reconnecting with the same token is pointless. Everything else
// (including 1006 "abnormal closure" from flaky networks) is transient.
function isAuthCloseCode(code: number): boolean {
  if (code === 1008) return true // Policy Violation
  if (code === 4401 || code === 4403) return true // Custom auth rejection
  return false
}

export type EventHandler = (context: string, payload: unknown) => void

export type EventServiceConfig = {
  url: string
  getToken: () => Promise<string>
  onUnauthorized?: () => void
}

function encodeBase64Url(input: string): string {
  const b64 = typeof btoa === "function" ? btoa(input) : Buffer.from(input, "utf8").toString("base64")
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export class EventServiceClient {
  private readonly url: string
  private readonly getToken: () => Promise<string>
  private readonly onUnauthorized: (() => void) | undefined

  private ws: WebSocket | null = null
  private connected = false
  private destroyed = false
  private reconnectAttempts = 0
  private hasConnectedBefore = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private abortHandshake: ((err: Error) => void) | null = null

  private eventHandlers = new Map<string, Set<EventHandler>>()
  private activeContexts = new Set<string>()
  private reconnectHandlers = new Set<() => void>()

  constructor(config: EventServiceConfig) {
    this.url = config.url
    this.getToken = config.getToken
    this.onUnauthorized = config.onUnauthorized
  }

  async connect(): Promise<void> {
    this.destroyed = false
    this.reconnectAttempts = 0
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      await this.connectOnce()
    } catch (err) {
      if (this.handleAuthFailure(err)) return
      if (!this.destroyed) this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.destroyed = true
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

  on<N extends KiloChatEventName>(event: N, handler: (ctx: string, payload: KiloChatEventMap[N]) => void): () => void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>()
    const wrapped: EventHandler = (ctx, payload) => handler(ctx, payload as KiloChatEventMap[N])
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
    if (this.ws) {
      const old = this.ws
      this.ws = null
      old.close()
    }

    const token = await this.getToken()
    const subprotocol = `${SUBPROTOCOL_PREFIX}${encodeBase64Url(token)}`

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${this.url}/connect`, [subprotocol])
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
      }, HANDSHAKE_TIMEOUT_MS)

      ws.addEventListener("open", () => {
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
        this.handleMessage(String(event.data))
      })

      ws.addEventListener("close", (event: CloseEvent) => {
        if (this.ws !== ws) return
        const wasConnected = this.connected
        this.connected = false
        this.stopPing()
        this.clearHandshakeTimer()
        // A handshake failure always fires `close` after `error`, so we
        // settle here with a classification based on the close code:
        // explicit auth/policy codes → fatal; anything else → transient
        // and the caller (`connect`) will schedule a reconnect.
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

      ws.addEventListener("error", () => {
        // Swallowed: the `close` event fires right after and carries the
        // close code we need to distinguish auth failures from network
        // blips. Settling here loses that context.
      })
    })
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
      this.connectOnce().catch((err) => {
        if (this.handleAuthFailure(err)) return
        if (!this.destroyed) this.scheduleReconnect()
      })
    }, delay)
  }
}
