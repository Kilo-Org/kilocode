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
type MigrationCompleteListener = () => void
type FavoritesChangeListener = (favorites: Array<{ providerID: string; modelID: string }>) => void
type ClearPendingPromptsListener = () => void
type DirectoryProvider = () => string[]

// Poll /global/health at the same interval as packages/app/src/context/server.tsx.
// This provides a second detection channel for server death independent of the SSE heartbeat.
const HEALTH_POLL_INTERVAL_MS = 10_000

/**
 * Reject all pending network-offline waits for a given directory.
 * The network namespace is not yet in the SDK KiloClient type (pending SDK regeneration),
 * so we access it via a type assertion.
 */
async function drainNetworkWaits(client: KiloClient, dir: string) {
  const net = (client as any).network as
    | {
        list: (p: { directory: string }) => Promise<{ data?: { id: string }[]; error?: unknown }>
        reject: (p: { requestID: string; directory: string }) => Promise<{ error?: unknown }>
      }
    | undefined
  if (!net) return
  const { data: waits, error: err } = await net.list({ directory: dir })
  if (err) throw new Error(`Failed to list network waits for ${dir}: ${String(err)}`)
  if (!waits) return
  for (const w of waits) {
    const { error } = await net.reject({ requestID: w.id, directory: dir })
    if (error) throw new Error(`Failed to reject network wait ${w.id}: ${String(error)}`)
  }
}

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
  private remoteService: import("../RemoteStatusService").RemoteStatusService | null = null

  private readonly eventListeners: Set<SSEEventListener> = new Set()
  private readonly stateListeners: Set<StateListener> = new Set()
  private readonly notificationDismissListeners: Set<NotificationDismissListener> = new Set()
  private readonly languageChangeListeners: Set<LanguageChangeListener> = new Set()
  private readonly profileChangeListeners: Set<ProfileChangeListener> = new Set()
  private readonly migrationCompleteListeners: Set<MigrationCompleteListener> = new Set()
  private readonly favoritesChangeListeners: Set<FavoritesChangeListener> = new Set()
  private readonly clearPendingPromptsListeners: Set<ClearPendingPromptsListener> = new Set()
  private readonly directoryProviders: Set<DirectoryProvider> = new Set()

  /**
   * Shared mapping used to resolve session scope for events that don't reliably include a sessionID.
   * Used primarily for message.part.updated where only messageID may be present.
   */
  private readonly messageSessionIdsByMessageId: Map<string, string> = new Map()

  /** Provider key → single focused session ID. */
  private readonly focused: Map<string, string> = new Map()
  /** Provider key → all open (background) session IDs. */
  private readonly opened: Map<string, string[]> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private unsubRemote: (() => void) | null = null

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
   * Get the shared SDK client, auto-connecting if not yet started.
   * Accepts an optional directory to use as the workspace root; falls back
   * to the first VS Code workspace folder. Throws if neither is available
   * or if the connection fails.
   */
  async getClientAsync(dir?: string): Promise<KiloClient> {
    if (this.client) return this.client
    const root = dir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) throw new Error("No workspace folder open")
    await this.connect(root)
    return this.client!
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
   * Set the remote status service. When remote is disabled, flushViewed()
   * is a no-op. When remote becomes enabled (startup refresh, user toggle,
   * or SSE event), the accumulated focused/opened state is automatically
   * flushed so the server is never left unaware of already-open sessions.
   */
  setRemoteService(service: import("../RemoteStatusService").RemoteStatusService | null): void {
    this.unsubRemote?.()
    this.unsubRemote = null
    this.remoteService = service
    if (service) {
      this.unsubRemote = service.onChange((state) => {
        if (state.enabled) this.flushViewed()
      })
    }
  }

  private isRemoteEnabled(): boolean {
    return this.remoteService?.getState().enabled ?? false
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
   * Subscribe to migration-complete events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onMigrationComplete(listener: MigrationCompleteListener): () => void {
    this.migrationCompleteListeners.add(listener)
    return () => {
      this.migrationCompleteListeners.delete(listener)
    }
  }

  /**
   * Broadcast a migration-complete event to all subscribed KiloProvider instances.
   */
  notifyMigrationComplete(): void {
    for (const listener of this.migrationCompleteListeners) {
      listener()
    }
  }

  /**
   * Subscribe to favorites change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onFavoritesChanged(listener: FavoritesChangeListener): () => void {
    this.favoritesChangeListeners.add(listener)
    return () => {
      this.favoritesChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a favorites change event to all subscribed KiloProvider instances.
   */
  notifyFavoritesChanged(favorites: Array<{ providerID: string; modelID: string }>): void {
    for (const listener of this.favoritesChangeListeners) {
      listener(favorites)
    }
  }

  /**
   * Subscribe to clear-pending-prompts broadcast. Returns unsubscribe function.
   * Fired after a config save drains all pending permissions/questions so each
   * webview can clear stale prompt UI.
   */
  onClearPendingPrompts(listener: ClearPendingPromptsListener): () => void {
    this.clearPendingPromptsListeners.add(listener)
    return () => {
      this.clearPendingPromptsListeners.delete(listener)
    }
  }

  /**
   * Register a callback that returns workspace directories tracked by a
   * KiloProvider (root + worktree dirs). Used by drainPendingPrompts() to
   * cover all active Instance directories across every provider.
   */
  registerDirectoryProvider(provider: DirectoryProvider): () => void {
    this.directoryProviders.add(provider)
    return () => {
      this.directoryProviders.delete(provider)
    }
  }

  /**
   * Reject all pending permission requests and questions across every
   * directory known to any KiloProvider **and** every project the CLI
   * backend has ever opened. The project list covers worktree sessions
   * whose provider was disposed (panel/sidebar closed) while the CLI
   * backend kept running.
   *
   * Must be called before operations that trigger Instance.disposeAll()
   * (e.g. config save) to prevent orphaned Promises from freezing
   * sessions.
   *
   * Throws if any list/reject call fails so callers can abort the
   * destructive operation.
   */
  async drainPendingPrompts(): Promise<void> {
    if (!this.client) return

    // Collect directories from all mounted providers (root + worktree dirs).
    const dirs = new Set<string>()
    for (const provider of this.directoryProviders) {
      for (const dir of provider()) {
        dirs.add(dir)
      }
    }

    // Also include every project directory the CLI backend knows about.
    // This covers worktree sessions whose KiloProvider was already disposed.
    const { data: projects, error: projectsErr } = await this.client.project.list()
    if (projectsErr) throw new Error(`Failed to list projects: ${String(projectsErr)}`)
    if (projects) {
      for (const p of projects) {
        dirs.add(p.worktree)
      }
    }

    for (const dir of dirs) {
      const { data: perms, error: permsErr } = await this.client.permission.list({ directory: dir })
      if (permsErr) throw new Error(`Failed to list permissions for ${dir}: ${String(permsErr)}`)
      if (perms) {
        for (const perm of perms) {
          const { error } = await this.client.permission.reply({ requestID: perm.id, reply: "reject", directory: dir })
          if (error) throw new Error(`Failed to reject permission ${perm.id}: ${String(error)}`)
        }
      }
      const { data: qs, error: qsErr } = await this.client.question.list({ directory: dir })
      if (qsErr) throw new Error(`Failed to list questions for ${dir}: ${String(qsErr)}`)
      if (qs) {
        for (const q of qs) {
          const { error } = await this.client.question.reject({ requestID: q.id, directory: dir })
          if (error) throw new Error(`Failed to reject question ${q.id}: ${String(error)}`)
        }
      }
      await drainNetworkWaits(this.client, dir)
    }
    for (const listener of this.clearPendingPromptsListeners) {
      listener()
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
   * Register the session a provider is actively viewing (focused).
   * After any change the aggregated set is sent to the server (debounced).
   */
  registerFocused(key: string, sessionID: string): void {
    if (this.focused.get(key) === sessionID) return
    this.focused.set(key, sessionID)
    this.flushViewed()
  }

  /**
   * Unregister a provider's focused session (e.g. on dispose, hidden, or clearSession).
   */
  unregisterFocused(key: string): void {
    if (!this.focused.has(key)) return
    this.focused.delete(key)
    this.flushViewed()
  }

  /**
   * Register the open (background tab) session IDs for a provider.
   * Sessions that appear in both focused and open are reported as focused only.
   */
  registerOpen(key: string, ids: string[]): void {
    const prev = this.opened.get(key)
    if (prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])) return
    this.opened.set(key, ids)
    this.flushViewed()
  }

  /** Debounced: send the aggregated focused + open session IDs to the server. */
  flushViewed(): void {
    if (!this.isRemoteEnabled()) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      const focus = new Set(this.focused.values())
      const open = new Set<string>()
      for (const ids of this.opened.values()) {
        for (const id of ids) {
          if (!focus.has(id)) open.add(id)
        }
      }
      this.client?.session
        .viewed({ focused: [...focus], open: [...open] })
        .catch((err) => console.warn("[Kilo New] ConnectionService: viewed flush failed:", err))
    }, 150)
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
    this.migrationCompleteListeners.clear()
    this.favoritesChangeListeners.clear()
    this.clearPendingPromptsListeners.clear()
    this.directoryProviders.clear()
    this.messageSessionIdsByMessageId.clear()
    this.focused.clear()
    this.opened.clear()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.unsubRemote?.()
    this.unsubRemote = null
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
        this.sseClient?.reconnect()
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
