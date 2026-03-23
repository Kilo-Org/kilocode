import * as vscode from "vscode"
import { ServerManager } from "./server-manager"
import { createKiloClient, type KiloClient, type Event } from "@kilocode/sdk/v2/client"
import { SdkSSEAdapter } from "./sdk-sse-adapter"
import type { ServerConfig } from "./types"
import { resolveEventSessionId as resolveEventSessionIdPure } from "./connection-utils"

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"
type SSEEventListener = (event: Event) => void
type StateListener = (state: ConnectionState) => void
type SSEEventFilter = (event: Event) => boolean
type NotificationDismissListener = (notificationId: string) => void
type LanguageChangeListener = (locale: string) => void
type ProfileChangeListener = (data: unknown) => void

// Poll /global/health at the same interval as packages/app/src/context/server.tsx.
// This provides a second detection channel for server death independent of the SSE heartbeat.
const HEALTH_POLL_INTERVAL_MS = 10_000

/**
 * Shared connection service that owns the single ServerManager, KiloClient (SDK), and SdkSSEAdapter.
 * Multiple KiloProvider instances subscribe to it for SSE events and state changes.
 */
export class KiloConnectionService {
  private readonly serverManager: ServerManager
  private client: KiloClient | null = null
  private sseClient: SdkSSEAdapter | null = null
  private info: { port: number } | null = null
  private config: ServerConfig | null = null
  private state: ConnectionState = "disconnected"
  private connectPromise: Promise<void> | null = null
  private healthPollTimer: ReturnType<typeof setInterval> | null = null

  private readonly eventListeners: Set<SSEEventListener> = new Set()
  private readonly stateListeners: Set<StateListener> = new Set()
  private readonly notificationDismissListeners: Set<NotificationDismissListener> = new Set()
  private readonly languageChangeListeners: Set<LanguageChangeListener> = new Set()
  private readonly profileChangeListeners: Set<ProfileChangeListener> = new Set()

  /**
   * Shared mapping used to resolve session scope for events that don't reliably include a sessionID.
   * Used primarily for message.part.updated where only messageID may be present.
   */
  private readonly messageSessionIdsByMessageId: Map<string, string> = new Map()

  constructor(context: vscode.ExtensionContext) {
    this.serverManager = new ServerManager(context)
  }

  /**
   * Lazily start server + SSE. Multiple callers share the same promise.
   */
  async connect(workspaceDir: string): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }
    if (this.state === "connected") {
      return
    }

    // Mark as connecting early so concurrent callers won't start another connection attempt.
    this.setState("connecting")

    this.connectPromise = this.doConnect(workspaceDir)
    try {
      await this.connectPromise
    } catch (error) {
      // If doConnect() fails before SSE can emit a state transition, avoid leaving consumers stuck in "connecting".
      this.setState("error")
      throw error
    } finally {
      this.connectPromise = null
    }
  }

  /**
   * Get the shared SDK client. Throws if not connected.
   */
  getClient(): KiloClient {
    if (!this.client) {
      throw new Error("Not connected — call connect() first")
    }
    return this.client
  }

  /**
   * Get server info (port). Returns null if not connected.
   */
  getServerInfo(): { port: number } | null {
    return this.info
  }

  /**
   * Get server config (baseUrl + password). Returns null if not connected.
   * Used by TelemetryProxy to POST events to the CLI server.
   */
  getServerConfig(): ServerConfig | null {
    return this.config
  }

  /**
   * Current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.state
  }

  /**
   * Subscribe to SSE events. Returns unsubscribe function.
   */
  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Subscribe to SSE events with a filter. The filter runs for every incoming SSE event.
   */
  onEventFiltered(filter: SSEEventFilter, listener: SSEEventListener): () => void {
    const wrapped: SSEEventListener = (event) => {
      if (!filter(event)) {
        return
      }
      listener(event)
    }
    return this.onEvent(wrapped)
  }

  /**
   * Record a messageID -> sessionID mapping, typically from message.updated or from HTTP message history.
   */
  recordMessageSessionId(messageId: string, sessionId: string): void {
    if (!messageId || !sessionId) {
      return
    }
    this.messageSessionIdsByMessageId.set(messageId, sessionId)
  }

  /**
   * Best-effort sessionID extraction for an SSE event.
   * Returns undefined for global events.
   */
  resolveEventSessionId(event: Event): string | undefined {
    return resolveEventSessionIdPure(
      event,
      (messageId) => this.messageSessionIdsByMessageId.get(messageId),
      (messageId, sessionId) => this.recordMessageSessionId(messageId, sessionId),
    )
  }

  /**
   * Subscribe to notification dismiss events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onNotificationDismissed(listener: NotificationDismissListener): () => void {
    this.notificationDismissListeners.add(listener)
    return () => {
      this.notificationDismissListeners.delete(listener)
    }
  }

  /**
   * Broadcast a notification dismiss event to all subscribed KiloProvider instances.
   */
  notifyNotificationDismissed(notificationId: string): void {
    for (const listener of this.notificationDismissListeners) {
      listener(notificationId)
    }
  }

  /**
   * Subscribe to language change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onLanguageChanged(listener: LanguageChangeListener): () => void {
    this.languageChangeListeners.add(listener)
    return () => {
      this.languageChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a language change event to all subscribed KiloProvider instances.
   */
  notifyLanguageChanged(locale: string): void {
    for (const listener of this.languageChangeListeners) {
      listener(locale)
    }
  }

  /**
   * Subscribe to profile change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onProfileChanged(listener: ProfileChangeListener): () => void {
    this.profileChangeListeners.add(listener)
    return () => {
      this.profileChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a profile change event to all subscribed KiloProvider instances.
   */
  notifyProfileChanged(data: unknown): void {
    for (const listener of this.profileChangeListeners) {
      listener(data)
    }
  }

  /**
   * Subscribe to connection state changes. Returns unsubscribe function.
   */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /**
   * Clean up everything: kill server, close SSE, clear listeners.
   */
  dispose(): void {
    this.stopHealthPoll()
    this.sseClient?.dispose()
    this.serverManager.dispose()
    this.eventListeners.clear()
    this.stateListeners.clear()
    this.notificationDismissListeners.clear()
    this.profileChangeListeners.clear()
    this.messageSessionIdsByMessageId.clear()
    this.client = null
    this.sseClient = null
    this.config = null
    this.info = null
    this.state = "disconnected"
  }

  private setState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  /**
   * Start polling GET /global/health every 10 seconds.
   * Ported from packages/app/src/context/server.tsx (HEALTH_POLL_INTERVAL_MS).
   * Provides a second detection channel for server death independent of the SSE heartbeat.
   * If the health check fails while we believe we are connected, the SSE client is
   * disconnected so its reconnect loop kicks in immediately.
   */
  private startHealthPoll(baseUrl: string, password: string): void {
    this.stopHealthPoll()

    this.healthPollTimer = setInterval(async () => {
      if (this.state !== "connected") {
        return
      }
      const healthy = await this.checkHealth(baseUrl, password)
      if (!healthy && this.state === "connected") {
        console.warn("[Kilo New] ConnectionService: ❤️‍🩹 Health check failed — forcing SSE reconnect")
        this.sseClient?.disconnect()
      }
    }, HEALTH_POLL_INTERVAL_MS)

    // Don't keep the extension host alive just for the health poll
    this.healthPollTimer.unref?.()
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer)
      this.healthPollTimer = null
    }
  }

  private async checkHealth(baseUrl: string, password: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${baseUrl}/global/health`, {
        headers: { Authorization: `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}` },
        signal: controller.signal,
      })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  private async doConnect(workspaceDir: string): Promise<void> {
    // If we reconnect, ensure the previous SSE connection is cleaned up first.
    this.stopHealthPoll()
    this.sseClient?.dispose()

    const server = await this.serverManager.getServer()
    this.info = { port: server.port }

    const config: ServerConfig = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      password: server.password,
    }

    this.config = config

    // Create SDK client with Basic Auth header
    const authHeader = `Basic ${Buffer.from(`kilo:${server.password}`).toString("base64")}`
    this.client = createKiloClient({
      baseUrl: config.baseUrl,
      headers: {
        Authorization: authHeader,
      },
    })

    this.sseClient = new SdkSSEAdapter(this.client)

    // Wait until SSE actually reaches a terminal state before resolving connect().
    let resolveConnected: (() => void) | null = null
    let rejectConnected: ((error: Error) => void) | null = null
    const connectedPromise = new Promise<void>((resolve, reject) => {
      resolveConnected = resolve
      rejectConnected = reject
    })

    let didConnect = false

    // Wire SSE events → broadcast to all registered listeners
    this.sseClient.onEvent((event) => {
      for (const listener of this.eventListeners) {
        listener(event)
      }
    })

    this.sseClient.onError((error) => {
      this.setState("error")
      rejectConnected?.(error)
      resolveConnected = null
      rejectConnected = null
    })

    // Wire SSE state → broadcast to all registered state listeners
    this.sseClient.onStateChange((sseState) => {
      this.setState(sseState)

      if (sseState === "connected") {
        didConnect = true
        resolveConnected?.()
        resolveConnected = null
        rejectConnected = null
        return
      }

      if (!didConnect && sseState === "disconnected") {
        rejectConnected?.(new Error(`SSE connection ended in state: ${sseState}`))
        resolveConnected = null
        rejectConnected = null
      }
    })

    this.sseClient.connect()

    await connectedPromise

    // Start the independent health poll once we are confirmed connected.
    this.startHealthPoll(config.baseUrl, config.password)
  }
}
