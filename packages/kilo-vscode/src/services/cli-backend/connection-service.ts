import * as vscode from "vscode"
import { ServerManager } from "./server-manager"
import { HttpClient } from "./http-client"
import { SSEClient } from "./sse-client"
import type { ServerConfig, SSEEvent } from "./types"

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"
type SSEEventListener = (event: SSEEvent) => void
type StateListener = (state: ConnectionState) => void
type SSEEventFilter = (event: SSEEvent) => boolean

/**
 * Shared connection service that owns the single ServerManager, HttpClient, and SSEClient.
 * Multiple KiloProvider instances subscribe to it for SSE events and state changes.
 */
export class KiloConnectionService {
  private readonly serverManager: ServerManager
  private client: HttpClient | null = null
  private sseClient: SSEClient | null = null
  private info: { port: number } | null = null
  private state: ConnectionState = "disconnected"
  private connectPromise: Promise<void> | null = null

  private readonly eventListeners: Set<SSEEventListener> = new Set()
  private readonly stateListeners: Set<StateListener> = new Set()

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
   * Get the shared HttpClient. Throws if not connected.
   */
  getHttpClient(): HttpClient {
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
  resolveEventSessionId(event: SSEEvent): string | undefined {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        return event.properties.info.id
      case "session.status":
      case "session.idle":
      case "todo.updated":
        return event.properties.sessionID
      case "message.updated":
        this.recordMessageSessionId(event.properties.info.id, event.properties.info.sessionID)
        return event.properties.info.sessionID
      case "message.part.updated": {
        const part = event.properties.part as { messageID?: string; sessionID?: string }
        if (part.sessionID) {
          return part.sessionID
        }
        if (!part.messageID) {
          return undefined
        }
        return this.messageSessionIdsByMessageId.get(part.messageID)
      }
      case "permission.asked":
      case "permission.replied":
        return event.properties.sessionID
      default:
        return undefined
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
    this.sseClient?.dispose()
    this.serverManager.dispose()
    this.eventListeners.clear()
    this.stateListeners.clear()
    this.messageSessionIdsByMessageId.clear()
    this.client = null
    this.sseClient = null
    this.info = null
    this.state = "disconnected"
  }

  private setState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  private async doConnect(workspaceDir: string): Promise<void> {
    // If we reconnect, ensure the previous SSE connection is cleaned up first.
    this.sseClient?.dispose()

    const server = await this.serverManager.getServer()
    this.info = { port: server.port }

    const config: ServerConfig = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      password: server.password,
    }

    this.client = new HttpClient(config)
    this.sseClient = new SSEClient(config)

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

    this.sseClient.connect(workspaceDir)

    await connectedPromise
  }
}
