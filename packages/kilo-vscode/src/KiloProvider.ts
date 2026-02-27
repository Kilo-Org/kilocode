import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import {
  type HttpClient,
  type SessionInfo,
  type SSEEvent,
  type KiloConnectionService,
  type KilocodeNotification,
} from "./services/cli-backend"
import type { EditorContext } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"
import { buildWebviewHtml } from "./utils"
import { TelemetryProxy, type TelemetryPropertiesProvider } from "./services/telemetry"
import {
  sessionToWebview,
  normalizeProviders,
  filterVisibleAgents,
  buildSettingPath,
  mapSSEEventToWebviewMessage,
} from "./kilo-provider-utils"
import { isEventFromForeignProject } from "./services/cli-backend/sse-utils"

export class KiloProvider implements vscode.WebviewViewProvider, TelemetryPropertiesProvider {
  public static readonly viewType = "kilo-code.new.sidebarView"

  private webview: vscode.Webview | null = null
  private currentSession: SessionInfo | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"
  /** Cached providersLoaded payload so requestProviders can be served before httpClient is ready */
  private cachedProvidersMessage: unknown = null
  /** Cached agentsLoaded payload so requestAgents can be served before httpClient is ready */
  private cachedAgentsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before httpClient is ready */
  private cachedConfigMessage: unknown = null
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: unknown = null

  private trackedSessionIds: Set<string> = new Set()
  private syncedChildSessions: Set<string> = new Set()
  /** Per-session directory overrides (e.g., worktree paths registered by AgentManagerProvider). */
  private sessionDirectories = new Map<string, string>()
  /** Project ID for the current workspace, used to filter out sessions from other repositories. */
  private projectID: string | undefined
  /** Abort controller for the current loadMessages request; aborted when a new session is selected. */
  private loadMessagesAbort: AbortController | null = null
  /** Set when refreshSessions() is called before the HTTP client is ready.
   *  Cleared and retried once the connection transitions to "connected". */
  private pendingSessionRefresh = false
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null

  /** Lazily initialized ignore controller for .kilocodeignore filtering */
  private ignoreController: FileIgnoreController | null = null
  private ignoreControllerDir: string | null = null

  /** Optional interceptor called before the standard message handler.
   *  Return null to consume the message, or return a (possibly transformed) message. */
  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
  ) {
    TelemetryProxy.getInstance().setProvider(this)
  }

  getTelemetryProperties(): Record<string, unknown> {
    return {
      appName: "kilo-code",
      appVersion: this.extensionVersion,
      platform: "vscode",
      editorName: vscode.env.appName,
      vscodeVersion: vscode.version,
      machineId: vscode.env.machineId,
      vscodeIsTelemetryEnabled: vscode.env.isTelemetryEnabled,
    }
  }

  /**
   * Convenience getter that returns the shared HttpClient or null if not yet connected.
   * Preserves the existing null-check pattern used throughout handler methods.
   */
  private get httpClient(): HttpClient | null {
    try {
      return this.connectionService.getHttpClient()
    } catch {
      return null
    }
  }

  /**
   * Synchronize current extension-side state to the webview.
   * This is primarily used after a webview refresh where early postMessage calls
   * may have been dropped before the webview registered its message listeners.
   */
  private async syncWebviewState(reason: string): Promise<void> {
    const serverInfo = this.connectionService.getServerInfo()
    console.log("[Kilo New] KiloProvider: 🔄 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasHttpClient: !!this.httpClient,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      console.log("[Kilo New] KiloProvider: ⏭️ syncWebviewState skipped (webview not ready)")
      return
    }

    // Always push connection state first so the UI can render appropriately.
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
    })

    // Re-send ready so the webview can recover after refresh.
    if (serverInfo) {
      const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
      this.postMessage({
        type: "ready",
        serverInfo,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
        workspaceDirectory: this.getWorkspaceDirectory(this.currentSession?.id),
      })
    }

    // Always attempt to fetch+push profile when connected.
    if (this.connectionState === "connected" && this.httpClient) {
      console.log("[Kilo New] KiloProvider: 👤 syncWebviewState fetching profile...")
      try {
        const profileData = await this.httpClient.getProfile()
        console.log("[Kilo New] KiloProvider: 👤 syncWebviewState profile:", profileData ? "received" : "null")
        this.postMessage({
          type: "profileData",
          data: profileData,
        })
      } catch (error) {
        console.error("[Kilo New] KiloProvider: ❌ syncWebviewState failed to fetch profile:", error)
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    // Store the webview references
    this.isWebviewReady = false
    this.webview = webviewView.webview

    // Set up webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(webviewView.webview)

    // Initialize connection to CLI backend
    this.initializeConnection()
  }

  /**
   * Resolve a WebviewPanel for displaying the Kilo webview in an editor tab.
   */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(panel.webview)

    this.initializeConnection()
  }

  /**
   * Register a session created externally (e.g., worktree sessions from AgentManagerProvider).
   * Sets currentSession, adds to trackedSessionIds, and notifies the webview.
   */
  public registerSession(session: SessionInfo): void {
    this.currentSession = session
    this.trackedSessionIds.add(session.id)
    this.postMessage({
      type: "sessionCreated",
      session: this.sessionToWebview(session),
    })
  }

  /**
   * Add a session ID to the tracked set without changing currentSession.
   * Used to re-register worktree sessions after clearSession wipes the set.
   */
  public trackSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId)
  }

  /**
   * Register a directory override for a session (e.g., worktree path).
   * When set, all operations for this session use this directory instead of the workspace root.
   */
  public setSessionDirectory(sessionId: string, directory: string): void {
    this.sessionDirectories.set(sessionId, directory)
  }

  public clearSessionDirectory(sessionId: string): void {
    this.sessionDirectories.delete(sessionId)
  }

  /**
   * Re-fetch and send the full session list to the webview.
   * Called by AgentManagerProvider after worktree recovery completes.
   */
  public refreshSessions(): void {
    void this.handleLoadSessions()
  }

  public openCloudSession(sessionId: string): void {
    this.postMessage({ type: "openCloudSession", sessionId })
  }

  /**
   * Attach to a webview that already has its own HTML set.
   * Sets up message handling and connection without overriding HTML content.
   *
   * @param options.onBeforeMessage - Optional interceptor called before the standard handler.
   *   Return null to consume the message (stop propagation), or return the message
   *   (possibly transformed) to continue with standard handling.
   */
  public attachToWebview(
    webview: vscode.Webview,
    options?: { onBeforeMessage?: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null> },
  ): void {
    this.isWebviewReady = false
    this.webview = webview
    this.onBeforeMessage = options?.onBeforeMessage ?? null
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  /**
   * Set up the shared message handler for both sidebar and tab webviews.
   * Handles ALL message types so tabs have full functionality.
   */
  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      // Run interceptor if attached (e.g., AgentManagerProvider worktree logic)
      if (this.onBeforeMessage) {
        try {
          const result = await this.onBeforeMessage(message)
          if (result === null) return // consumed by interceptor
          message = result
        } catch (error) {
          console.error("[Kilo New] KiloProvider: interceptor error:", error)
          return
        }
      }

      switch (message.type) {
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          break
        case "sendMessage": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendMessage(
            message.text,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
          )
          break
        }
        case "abort":
          await this.handleAbort(message.sessionID)
          break
        case "permissionResponse":
          await this.handlePermissionResponse(message.permissionId, message.sessionID, message.response)
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.currentSession = null
          this.trackedSessionIds.clear()
          this.syncedChildSessions.clear()
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID)
          break
        case "syncSession":
          this.handleSyncSession(message.sessionID).catch((e) =>
            console.error("[Kilo New] handleSyncSession failed:", e),
          )
          break
        case "loadSessions":
          this.handleLoadSessions().catch((e) => console.error("[Kilo New] handleLoadSessions failed:", e))
          break
        case "login":
          await this.handleLogin()
          break
        case "cancelLogin":
          this.loginAttempt++
          this.postMessage({ type: "deviceAuthCancelled" })
          break
        case "logout":
          await this.handleLogout()
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await this.handleSetOrganization(message.organizationId)
          }
          break
        case "refreshProfile":
          await this.handleRefreshProfile()
          break
        case "openExternal":
          if (message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url))
          }
          break
        case "openFile":
          if (message.filePath) {
            this.handleOpenFile(message.filePath, message.line, message.column)
          }
          break
        case "requestProviders":
          this.fetchAndSendProviders().catch((e) => console.error("[Kilo New] fetchAndSendProviders failed:", e))
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestAgents":
          this.fetchAndSendAgents().catch((e) => console.error("[Kilo New] fetchAndSendAgents failed:", e))
          break
        case "questionReply":
          await this.handleQuestionReply(message.requestID, message.answers)
          break
        case "questionReject":
          await this.handleQuestionReject(message.requestID)
          break
        case "requestConfig":
          this.fetchAndSendConfig().catch((e) => console.error("[Kilo New] fetchAndSendConfig failed:", e))
          break
        case "updateConfig":
          await this.handleUpdateConfig(message.config)
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("kilo-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          break
        case "requestAutocompleteSettings":
          this.sendAutocompleteSettings()
          break
        case "updateAutocompleteSetting": {
          const allowedKeys = new Set([
            "enableAutoTrigger",
            "enableSmartInlineTaskKeybinding",
            "enableChatAutocomplete",
          ])
          if (allowedKeys.has(message.key)) {
            await vscode.workspace
              .getConfiguration("kilo-code.new.autocomplete")
              .update(message.key, message.value, vscode.ConfigurationTarget.Global)
            this.sendAutocompleteSettings()
          }
          break
        }
        case "requestChatCompletion":
          void handleChatCompletionRequest(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            { postMessage: (msg) => this.postMessage(msg) },
            this.connectionService,
          )
          break
        case "requestFileSearch": {
          const client = this.httpClient
          if (client) {
            const dir = this.getWorkspaceDirectory(this.currentSession?.id)
            void client
              .findFiles(message.query, dir)
              .then((paths) => {
                this.postMessage({ type: "fileSearchResult", paths, dir, requestId: message.requestId })
              })
              .catch((error) => {
                console.error("[Kilo New] File search failed:", error)
                this.postMessage({ type: "fileSearchResult", paths: [], dir, requestId: message.requestId })
              })
          } else {
            this.postMessage({ type: "fileSearchResult", paths: [], dir: "", requestId: message.requestId })
          }
          break
        }
        case "chatCompletionAccepted":
          handleChatCompletionAccepted({ type: "chatCompletionAccepted", suggestionLength: message.suggestionLength })
          break
        case "deleteSession":
          await this.handleDeleteSession(message.sessionID)
          break
        case "renameSession":
          await this.handleRenameSession(message.sessionID, message.title)
          break
        case "updateSetting":
          await this.handleUpdateSetting(message.key, message.value)
          break
        case "requestBrowserSettings":
          this.sendBrowserSettings()
          break
        case "requestNotificationSettings":
          this.sendNotificationSettings()
          break
        case "requestNotifications":
          this.fetchAndSendNotifications().catch((e) =>
            console.error("[Kilo New] fetchAndSendNotifications failed:", e),
          )
          break
        case "requestCloudSessions":
          await this.handleRequestCloudSessions(message)
          break
        case "requestGitRemoteUrl":
          void this.getGitRemoteUrl().then((url) => {
            this.postMessage({ type: "gitRemoteUrlLoaded", gitUrl: url ?? null })
          })
          break
        case "requestCloudSessionData":
          void this.handleRequestCloudSessionData(message.sessionId)
          break
        case "importAndSend": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          void this.handleImportAndSend(
            message.cloudSessionId,
            message.text,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
          )
          break
        }
        case "dismissNotification":
          await this.handleDismissNotification(message.notificationId)
          break
        case "resetAllSettings":
          await this.handleResetAllSettings()
          break
        case "telemetry":
          TelemetryProxy.capture(message.event, message.properties)
          break
        case "persistVariant": {
          const stored = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          stored[message.key] = message.value
          await this.extensionContext?.globalState.update("variantSelections", stored)
          break
        }
        case "requestVariants": {
          const variants = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          this.postMessage({ type: "variantsLoaded", variants })
          break
        }
      }
    })
  }

  /**
   * Initialize connection to the CLI backend server.
   * Subscribes to the shared KiloConnectionService.
   */
  private async initializeConnection(): Promise<void> {
    console.log("[Kilo New] KiloProvider: 🔧 Starting initializeConnection...")

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (event) => {
          const sessionId = this.connectionService.resolveEventSessionId(event)

          // message.part.updated and message.part.delta are always session-scoped; drop if session unknown.
          if (!sessionId) {
            return event.type !== "message.part.updated" && event.type !== "message.part.delta"
          }

          return this.trackedSessionIds.has(sessionId)
        },
        (event) => {
          this.handleSSEEvent(event)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state) => {
        this.connectionState = state
        this.postMessage({ type: "connectionState", state })

        if (state === "connected") {
          try {
            const client = this.httpClient
            if (client) {
              const profileData = await client.getProfile()
              this.postMessage({ type: "profileData", data: profileData })
            }
            await this.syncWebviewState("sse-connected")
            await this.flushPendingSessionRefresh("sse-connected")
          } catch (error) {
            console.error("[Kilo New] KiloProvider: ❌ Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : "Failed to sync after connecting",
            })
          }
        }
      })

      // Subscribe to notification dismiss broadcast from other KiloProvider instances
      this.unsubscribeNotificationDismiss = this.connectionService.onNotificationDismissed(() => {
        this.fetchAndSendNotifications()
      })

      // Get current state and push to webview
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = this.connectionService.getConnectionState()

      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
        this.postMessage({
          type: "ready",
          serverInfo,
          extensionVersion: this.extensionVersion,
          vscodeLanguage: vscode.env.language,
          languageOverride: langConfig.get<string>("language"),
          workspaceDirectory: this.getWorkspaceDirectory(this.currentSession?.id),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      await this.syncWebviewState("initializeConnection")
      await this.flushPendingSessionRefresh("initializeConnection")

      // Fetch providers, agents, config, and notifications in parallel
      await Promise.all([
        this.fetchAndSendProviders(),
        this.fetchAndSendAgents(),
        this.fetchAndSendConfig(),
        this.fetchAndSendNotifications(),
      ])
      this.sendNotificationSettings()

      console.log("[Kilo New] KiloProvider: ✅ initializeConnection completed successfully")
    } catch (error) {
      console.error("[Kilo New] KiloProvider: ❌ Failed to initialize connection:", error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to CLI backend",
      })
    }
  }

  private sessionToWebview(session: SessionInfo) {
    return sessionToWebview(session)
  }

  /**
   * Handle creating a new session.
   */
  private async handleCreateSession(): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const session = await this.httpClient.createSession(workspaceDir)
      this.currentSession = session
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(session),
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to create session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create session",
      })
    }
  }

  /**
   * Handle loading messages for a session.
   */
  private async handleLoadMessages(sessionID: string): Promise<void> {
    // Track the session so we receive its SSE events
    this.trackedSessionIds.add(sessionID)

    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
        sessionID,
      })
      return
    }

    // Abort any previous in-flight loadMessages request so the backend
    // isn't overwhelmed when the user switches sessions rapidly.
    this.loadMessagesAbort?.abort()
    const abort = new AbortController()
    this.loadMessagesAbort = abort

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await this.httpClient.getMessages(sessionID, workspaceDir, abort.signal)

      // If this request was aborted while awaiting, skip posting stale results
      if (abort.signal.aborted) return

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching to a historical session.
      // Non-blocking: don't let a failure here prevent messages from loading.
      // 404s are expected for cross-worktree sessions — use silent to suppress HTTP error logs.
      this.httpClient
        .getSession(sessionID, workspaceDir, true)
        .then((session) => {
          if (!this.currentSession || this.currentSession.id === sessionID) {
            this.currentSession = session
          }
        })
        .catch((err) => console.warn("[Kilo New] KiloProvider: getSession failed (non-critical):", err))

      this.postMessage({
        type: "workspaceDirectoryChanged",
        directory: this.getWorkspaceDirectory(sessionID),
      })

      // Fetch current session status so the webview has the correct busy/idle
      // state after switching tabs (SSE events may have been missed).
      this.httpClient
        .getSessionStatuses(workspaceDir)
        .then((statuses) => {
          for (const [sid, info] of Object.entries(statuses)) {
            if (!this.trackedSessionIds.has(sid)) continue
            this.postMessage({
              type: "sessionStatus",
              sessionID: sid,
              status: info.type,
              ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
            })
          }
        })
        .catch((err) => console.error("[Kilo New] KiloProvider: Failed to fetch session statuses:", err))

      const messages = messagesData.map((m) => ({
        ...m.info,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })
    } catch (error) {
      // Silently ignore aborted requests — the user switched to a different session
      if (abort.signal.aborted) return
      console.error("[Kilo New] KiloProvider: Failed to load messages:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load messages",
        sessionID,
      })
    }
  }

  /**
   * Handle syncing a child session (e.g. spawned by the task tool).
   * Tracks the session for SSE events and fetches its messages.
   */
  private async handleSyncSession(sessionID: string): Promise<void> {
    if (!this.httpClient) return
    if (this.syncedChildSessions.has(sessionID)) return

    this.syncedChildSessions.add(sessionID)
    this.trackedSessionIds.add(sessionID)

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await this.httpClient.getMessages(sessionID, workspaceDir)

      const messages = messagesData.map((m) => ({
        ...m.info,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed to sync child session:", err)
    }
  }

  /**
   * Retry a deferred sessions refresh once the HTTP client is ready.
   */
  private async flushPendingSessionRefresh(reason: string): Promise<void> {
    if (!this.pendingSessionRefresh) {
      return
    }

    if (!this.httpClient) {
      if (this.connectionState === "connecting") {
        return
      }

      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    console.log("[Kilo New] KiloProvider: 🔄 Flushing deferred sessions refresh", { reason })
    await this.handleLoadSessions()
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    const client = this.httpClient
    if (!client) {
      // HTTP client isn't ready yet — mark for retry once connected.
      // This avoids silently dropping the request when initializeState()
      // calls refreshSessions() before the CLI server has started.
      this.pendingSessionRefresh = true

      if (this.connectionState !== "connecting") {
        this.postMessage({
          type: "error",
          message: "Not connected to CLI backend",
        })
      }
      return
    }

    this.pendingSessionRefresh = false

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const sessions = await client.listSessions(workspaceDir)

      // The primary fetch already returns all sessions for this project (scoped
      // by project_id on the backend). Worktree directories share the same
      // project_id so their sessions are included. We still fetch from worktree
      // directories in case a worktree resolved to a separate Instance, then
      // filter the merged results to the workspace project to prevent sessions
      // from other repositories from leaking in.
      const projectID = sessions[0]?.projectID
      const worktreeDirs = new Set(this.sessionDirectories.values())
      const extra = await Promise.all(
        [...worktreeDirs].map((dir) =>
          client.listSessions(dir).catch((err) => {
            console.error(`[Kilo New] KiloProvider: Failed to list sessions for ${dir}:`, err)
            return [] as SessionInfo[]
          }),
        ),
      )
      const seen = new Set(sessions.map((s) => s.id))
      for (const batch of extra) {
        for (const s of batch) {
          if (!seen.has(s.id) && (!projectID || s.projectID === projectID)) {
            sessions.push(s)
            seen.add(s.id)
          }
        }
      }
      // Update project ID when sessions are available; keep previous value when
      // the list is empty (empty ≠ different project — the workspace hasn't changed).
      const resolved = sessions[0]?.projectID
      if (resolved) this.projectID = resolved

      this.postMessage({
        type: "sessionsLoaded",
        sessions: sessions.map((s) => this.sessionToWebview(s)),
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to load sessions:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  }

  /**
   * Handle deleting a session.
   */
  private async handleDeleteSession(sessionID: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      await this.httpClient.deleteSession(sessionID, workspaceDir)
      this.trackedSessionIds.delete(sessionID)
      this.syncedChildSessions.delete(sessionID)
      this.sessionDirectories.delete(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = null
      }
      this.postMessage({ type: "sessionDeleted", sessionID })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to delete session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete session",
      })
    }
  }

  /**
   * Handle renaming a session.
   */
  private async handleRenameSession(sessionID: string, title: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const updated = await this.httpClient.updateSession(sessionID, { title }, workspaceDir)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = updated
      }
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to rename session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rename session",
      })
    }
  }

  /**
   * Fetch providers from the backend and send to webview.
   *
   * The backend `/provider` endpoint returns `all` as an array-like object with
   * numeric keys ("0", "1", …). The webview and sendMessage both need providers
   * keyed by their real `provider.id` (e.g. "anthropic", "openai"). We re-key
   * the map here so the rest of the code can use provider.id everywhere.
   */
  private async fetchAndSendProviders(): Promise<void> {
    if (!this.httpClient) {
      // httpClient not ready — serve from cache if available
      if (this.cachedProvidersMessage) {
        this.postMessage(this.cachedProvidersMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const response = await this.httpClient.listProviders(workspaceDir)

      const normalized = normalizeProviders(response.all)

      const config = vscode.workspace.getConfiguration("kilo-code.new.model")
      const providerID = config.get<string>("providerID", "kilo")
      const modelID = config.get<string>("modelID", "kilo/auto")

      const message = {
        type: "providersLoaded",
        providers: normalized,
        connected: response.connected,
        defaults: response.default,
        defaultSelection: { providerID, modelID },
      }
      this.cachedProvidersMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch providers:", error)
    }
  }

  /**
   * Fetch agents (modes) from the backend and send to webview.
   */
  private async fetchAndSendAgents(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedAgentsMessage) {
        this.postMessage(this.cachedAgentsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const agents = await this.httpClient.listAgents(workspaceDir)

      const { visible, defaultAgent } = filterVisibleAgents(agents)

      const message = {
        type: "agentsLoaded",
        agents: visible.map((a) => ({
          name: a.name,
          description: a.description,
          mode: a.mode,
          native: a.native,
          color: a.color,
        })),
        defaultAgent,
      }
      this.cachedAgentsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch agents:", error)
    }
  }

  /**
   * Fetch backend config and send to webview.
   */
  private async fetchAndSendConfig(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedConfigMessage) {
        this.postMessage(this.cachedConfigMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const config = await this.httpClient.getConfig(workspaceDir)

      const message = {
        type: "configLoaded",
        config,
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
    }
  }

  /**
   * Fetch Kilo news/notifications and send to webview.
   * Uses the cached message pattern so the webview gets data immediately on refresh.
   */
  private async fetchAndSendNotifications(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedNotificationsMessage) {
        this.postMessage(this.cachedNotificationsMessage)
      }
      return
    }

    try {
      const notifications = await this.httpClient.getNotifications()
      const existing = this.extensionContext?.globalState.get<string[]>("kilo.dismissedNotificationIds", []) ?? []
      const active = new Set(notifications.map((n) => n.id))
      const dismissedIds = existing.filter((id) => active.has(id))
      if (dismissedIds.length !== existing.length) {
        await this.extensionContext?.globalState.update("kilo.dismissedNotificationIds", dismissedIds)
      }
      const message = { type: "notificationsLoaded", notifications, dismissedIds }
      this.cachedNotificationsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch notifications:", error)
    }
  }

  /**
   * Handle cloud sessions request from webview.
   * Fetches sessions from the Kilo cloud API and sends them back.
   */
  private async handleRequestCloudSessions(message: {
    cursor?: string
    limit?: number
    gitUrl?: string
  }): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const result = await this.httpClient.getCloudSessions({
        cursor: message.cursor,
        limit: message.limit,
        gitUrl: message.gitUrl,
      })

      this.postMessage({
        type: "cloudSessionsLoaded",
        sessions: result?.cliSessions ?? [],
        nextCursor: result?.nextCursor ?? null,
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch cloud sessions:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to fetch cloud sessions",
      })
    }
  }

  /**
   * Fetch full cloud session data for read-only preview.
   * Transforms the export data into webview message format and sends it back.
   */
  private async handleRequestCloudSessionData(sessionId: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId: sessionId,
        error: "Not connected to CLI backend",
      })
      return
    }

    try {
      const data = await this.httpClient.getCloudSession(sessionId)
      if (!data) {
        this.postMessage({
          type: "cloudSessionImportFailed",
          cloudSessionId: sessionId,
          error: "Failed to fetch cloud session",
        })
        return
      }

      const messages = (data.messages ?? [])
        .filter((m) => m.info)
        .map((m) => ({
          id: m.info.id,
          sessionID: m.info.sessionID,
          role: m.info.role as "user" | "assistant",
          parts: m.parts,
          createdAt: m.info.time?.created ? new Date(m.info.time.created).toISOString() : new Date().toISOString(),
          cost: m.info.cost,
          tokens: m.info.tokens,
        }))

      this.postMessage({
        type: "cloudSessionDataLoaded",
        cloudSessionId: sessionId,
        title: data.info.title ?? "Untitled",
        messages,
      })
    } catch (err) {
      console.error("[Kilo New] Failed to load cloud session data:", err)
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId: sessionId,
        error: err instanceof Error ? err.message : "Failed to load cloud session",
      })
    }
  }

  /**
   * Import a cloud session to local storage, then send a new message on it.
   * This is the "clone on first message" flow — the cloud session becomes a
   * local session only when the user decides to continue it.
   */
  private async handleImportAndSend(
    cloudSessionId: string,
    text: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
  ): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId,
        error: "Not connected to CLI backend",
      })
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()

    // Step 1: Import the cloud session with fresh IDs
    const session = await this.httpClient.importCloudSession(cloudSessionId, workspaceDir)
    if (!session) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId,
        error: "Failed to import session from cloud",
      })
      return
    }

    // Track the new local session
    this.currentSession = session
    this.trackedSessionIds.add(session.id)

    // Notify webview of the import success
    this.postMessage({
      type: "cloudSessionImported",
      cloudSessionId,
      session: this.sessionToWebview(session),
    })

    // Step 2: Send the user's message on the new local session
    const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []

    if (files) {
      for (const f of files) {
        parts.push({ type: "file", mime: f.mime, url: f.url })
      }
    }

    parts.push({ type: "text", text })

    try {
      const editorContext = await this.gatherEditorContext()

      await this.httpClient.sendMessage(session.id, parts, workspaceDir, {
        providerID,
        modelID,
        agent,
        variant,
        editorContext,
      })
    } catch (err) {
      console.error("[Kilo New] Failed to send message after cloud import:", err)
      this.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to send message after import",
        sessionID: session.id,
      })
    }
  }

  /**
   * Persist a dismissed notification ID in globalState and push updated lists to webview.
   */
  private async handleDismissNotification(notificationId: string): Promise<void> {
    if (!this.extensionContext) return
    const existing = this.extensionContext.globalState.get<string[]>("kilo.dismissedNotificationIds", [])
    if (!existing.includes(notificationId)) {
      await this.extensionContext.globalState.update("kilo.dismissedNotificationIds", [...existing, notificationId])
    }
    await this.fetchAndSendNotifications()
    this.connectionService.notifyNotificationDismissed(notificationId)
  }

  /**
   * Read notification/sound settings from VS Code config and push to webview.
   */
  private sendNotificationSettings(): void {
    const notifications = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        notifyAgent: notifications.get<boolean>("agent", true),
        notifyPermissions: notifications.get<boolean>("permissions", true),
        notifyErrors: notifications.get<boolean>("errors", true),
        soundAgent: sounds.get<string>("agent", "default"),
        soundPermissions: sounds.get<string>("permissions", "default"),
        soundErrors: sounds.get<string>("errors", "default"),
      },
    })
  }

  /**
   * Handle config update request from the webview.
   * Applies a partial config update via the global config endpoint, then pushes
   * the full merged config back to the webview.
   */
  private async handleUpdateConfig(partial: Record<string, unknown>): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const updated = await this.httpClient.updateConfig(partial)

      const message = {
        type: "configUpdated",
        config: updated,
      }
      this.cachedConfigMessage = { type: "configLoaded", config: updated }
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to update config:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update config",
      })
    }
  }

  /**
   * Handle sending a message from the webview.
   */
  private async handleSendMessage(
    text: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
  ): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID || this.currentSession?.id)

      // Create session if needed
      if (!sessionID && !this.currentSession) {
        this.currentSession = await this.httpClient.createSession(workspaceDir)
        this.trackedSessionIds.add(this.currentSession.id)
        // Notify webview of the new session
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(this.currentSession),
        })
      }

      const targetSessionID = sessionID || this.currentSession?.id
      if (!targetSessionID) {
        throw new Error("No session available")
      }

      // Build parts array with file context and user text
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []

      // Add any explicitly attached files from the webview
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url })
        }
      }

      parts.push({ type: "text", text })

      const editorContext = await this.gatherEditorContext()

      await this.httpClient.sendMessage(targetSessionID, parts, workspaceDir, {
        providerID,
        modelID,
        agent,
        variant,
        editorContext,
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to send message:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to send message",
      })
    }
  }

  /**
   * Handle abort request from the webview.
   */
  private async handleAbort(sessionID?: string): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await this.httpClient.abortSession(targetSessionID, workspaceDir)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to abort session:", error)
    }
  }

  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const target = sessionID || this.currentSession?.id
    if (!target) {
      console.error("[Kilo New] KiloProvider: No sessionID for compact")
      return
    }

    if (!providerID || !modelID) {
      console.error("[Kilo New] KiloProvider: No model selected for compact")
      this.postMessage({
        type: "error",
        message: "No model selected. Connect a provider to compact this session.",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(target)
      await this.httpClient.summarize(target, providerID, modelID, workspaceDir)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to compact session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to compact session",
      })
    }
  }

  /**
   * Handle permission response from the webview.
   */
  private async handlePermissionResponse(
    permissionId: string,
    sessionID: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      console.error("[Kilo New] KiloProvider: No sessionID for permission response")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await this.httpClient.respondToPermission(targetSessionID, permissionId, response, workspaceDir)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
    }
  }

  /**
   * Handle question reply from the webview.
   */
  private async handleQuestionReply(requestID: string, answers: string[][]): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.httpClient.replyToQuestion(requestID, answers, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to reply to question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle question reject (dismiss) from the webview.
   */
  private async handleQuestionReject(requestID: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.httpClient.rejectQuestion(requestID, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to reject question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle login request from the webview.
   * Uses the provider OAuth flow: authorize → open browser → callback (polls until complete).
   * Sends device auth messages so the webview can display a QR code, verification code, and timer.
   */
  private async handleLogin(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const attempt = ++this.loginAttempt

    console.log("[Kilo New] KiloProvider: 🔐 Starting login flow...")

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Step 1: Initiate OAuth authorization
      const auth = await this.httpClient.oauthAuthorize("kilo", 0, workspaceDir)
      console.log("[Kilo New] KiloProvider: 🔐 Got auth URL:", auth.url)

      // Parse code from instructions (format: "Open URL and enter code: ABCD-1234")
      const codeMatch = auth.instructions?.match(/code:\s*(\S+)/i)
      const code = codeMatch ? codeMatch[1] : undefined

      // Step 2: Open browser for user to authorize
      vscode.env.openExternal(vscode.Uri.parse(auth.url))

      // Send device auth details to webview
      this.postMessage({
        type: "deviceAuthStarted",
        code,
        verificationUrl: auth.url,
        expiresIn: 900, // 15 minutes default
      })

      // Step 3: Wait for callback (blocks until polling completes)
      await this.httpClient.oauthCallback("kilo", 0, workspaceDir)

      // Check if this attempt was cancelled
      if (attempt !== this.loginAttempt) {
        return
      }

      console.log("[Kilo New] KiloProvider: 🔐 Login successful")

      // Step 4: Fetch profile and push to webview
      const profileData = await this.httpClient.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
      this.postMessage({ type: "deviceAuthComplete" })

      // Step 5: If user has organizations, navigate to profile view so they can pick one
      if (profileData?.profile.organizations && profileData.profile.organizations.length > 0) {
        this.postMessage({ type: "navigate", view: "profile" })
      }
    } catch (error) {
      if (attempt !== this.loginAttempt) {
        return
      }
      this.postMessage({
        type: "deviceAuthFailed",
        error: error instanceof Error ? error.message : "Login failed",
      })
    }
  }

  /**
   * Handle organization switch request from the webview.
   * Persists the selection and refreshes profile + providers since both change with org context.
   */
  private async handleSetOrganization(organizationId: string | null): Promise<void> {
    const client = this.httpClient
    if (!client) {
      return
    }

    console.log("[Kilo New] KiloProvider: Switching organization:", organizationId ?? "personal")
    try {
      await client.setOrganization(organizationId)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to switch organization:", error)
      // Re-fetch current profile to reset webview state (clears switching indicator)
      const profileData = await client.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
      return
    }

    // Org switch succeeded — refresh profile and providers independently (best-effort)
    try {
      const profileData = await client.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error)
    }
  }

  /**
   * Handle openFile request from the webview — open a file in the VS Code editor.
   */
  private handleOpenFile(filePath: string, line?: number, column?: number): void {
    const absolute = /^(?:\/|[a-zA-Z]:[\\/])/.test(filePath)
    const uri = absolute
      ? vscode.Uri.file(filePath)
      : vscode.Uri.joinPath(vscode.Uri.file(this.getWorkspaceDirectory()), filePath)
    vscode.workspace.openTextDocument(uri).then(
      (doc) => {
        const options: vscode.TextDocumentShowOptions = { preview: true }
        if (line !== undefined && line > 0) {
          const col = column !== undefined && column > 0 ? column - 1 : 0
          const pos = new vscode.Position(line - 1, col)
          options.selection = new vscode.Range(pos, pos)
        }
        vscode.window.showTextDocument(doc, options)
      },
      (err) => console.error("[Kilo New] KiloProvider: Failed to open file:", uri.fsPath, err),
    )
  }

  /**
   * Handle logout request from the webview.
   */
  private async handleLogout(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    console.log("[Kilo New] KiloProvider: 🚪 Logging out...")
    await this.httpClient.removeAuth("kilo")
    console.log("[Kilo New] KiloProvider: 🚪 Logged out successfully")
    this.postMessage({
      type: "profileData",
      data: null,
    })
  }

  /**
   * Handle profile refresh request from the webview.
   */
  private async handleRefreshProfile(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    console.log("[Kilo New] KiloProvider: 🔄 Refreshing profile...")
    const profileData = await this.httpClient.getProfile()
    this.postMessage({
      type: "profileData",
      data: profileData,
    })
  }

  /**
   * Handle a generic setting update from the webview.
   * The key uses dot notation relative to `kilo-code.new` (e.g. "browserAutomation.enabled").
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const { section, leaf } = buildSettingPath(key)
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    await config.update(leaf, value, vscode.ConfigurationTarget.Global)
  }

  /**
   * Reset all "kilo-code.new.*" extension settings to their defaults by reading
   * contributes.configuration from the extension's package.json at runtime.
   * Only resets settings under the "kilo-code.new." namespace to avoid touching
   * settings from the previous version of the extension which shares the same
   * extension ID and "kilo-code.*" namespace.
   */
  // kilocode_change start
  private async handleResetAllSettings(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "Reset all Kilo Code extension settings to defaults?",
      { modal: true },
      "Reset",
    )
    if (confirmed !== "Reset") return

    const prefix = "kilo-code.new."
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    const properties = ext?.packageJSON?.contributes?.configuration?.properties as Record<string, unknown> | undefined
    if (!properties) return

    for (const key of Object.keys(properties)) {
      if (!key.startsWith(prefix)) continue
      const parts = key.split(".")
      const section = parts.slice(0, -1).join(".")
      const leaf = parts[parts.length - 1]
      const config = vscode.workspace.getConfiguration(section)
      await config.update(leaf, undefined, vscode.ConfigurationTarget.Global)
    }

    // Re-send all settings to the webview so the UI reflects the reset
    this.sendAutocompleteSettings()
    this.sendBrowserSettings()
    this.sendNotificationSettings()
  }
  // kilocode_change end

  /**
   * Read the current browser automation settings and push them to the webview.
   */
  private sendBrowserSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    this.postMessage({
      type: "browserSettingsLoaded",
      settings: {
        enabled: config.get<boolean>("enabled", false),
        useSystemChrome: config.get<boolean>("useSystemChrome", true),
        headless: config.get<boolean>("headless", false),
      },
    })
  }

  /**
   * Extract sessionID from an SSE event, if applicable.
   * Returns undefined for global events (server.connected, server.heartbeat).
   */
  private extractSessionID(event: SSEEvent): string | undefined {
    return this.connectionService.resolveEventSessionId(event)
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by project ID and tracked session IDs so each webview only sees its own sessions.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Drop session events from other projects before any tracking logic.
    // This must come first: the trackedSessionIds guard below would otherwise
    // let a foreign session through if it was accidentally tracked.
    if (isEventFromForeignProject(event, this.projectID)) return

    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.updated and message.part.delta are always session-scoped; drop if session unknown.
    if (!sessionID && (event.type === "message.part.updated" || event.type === "message.part.delta")) {
      return
    }
    if (sessionID && !this.trackedSessionIds.has(sessionID)) {
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "session.created" && !this.currentSession) {
      this.currentSession = event.properties.info
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.info.id) {
      this.currentSession = event.properties.info
    }

    const msg = mapSSEEventToWebviewMessage(event, sessionID)
    if (msg) {
      this.postMessage(msg)
    }
  }

  /**
   * Read autocomplete settings from VS Code configuration and push to the webview.
   */
  private sendAutocompleteSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
    this.postMessage({
      type: "autocompleteSettingsLoaded",
      settings: {
        enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
        enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
        enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      },
    })
  }

  /**
   * Post a message to the webview.
   * Public so toolbar button commands can send messages.
   */
  public postMessage(message: unknown): void {
    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      console.warn("[Kilo New] KiloProvider: ⚠️ postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      console.error("[Kilo New] KiloProvider: ❌ postMessage failed", error)
    })
  }

  /**
   * Get the git remote URL for the current workspace using VS Code's built-in Git API.
   * Returns undefined if not in a git repo or no remotes are configured.
   */
  private async getGitRemoteUrl(): Promise<string | undefined> {
    try {
      const extension = vscode.extensions.getExtension("vscode.git")
      if (!extension) return undefined
      const api = extension.isActive ? extension.exports?.getAPI(1) : (await extension.activate())?.getAPI(1)
      if (!api) return undefined
      const repo = api.repositories?.[0]
      if (!repo) return undefined
      const remote = repo.state?.remotes?.find((r: { name: string }) => r.name === "origin")
      return remote?.fetchUrl ?? remote?.pushUrl
    } catch (error) {
      console.warn("[Kilo New] KiloProvider: Failed to get git remote URL:", error)
      return undefined
    }
  }

  /**
   * Gather VS Code editor context to send alongside messages to the CLI backend.
   */
  /**
   * Get or create a FileIgnoreController for the current workspace directory.
   * Reinitializes if the workspace directory has changed.
   */
  private async getIgnoreController(workspaceDir: string): Promise<FileIgnoreController> {
    if (this.ignoreController && this.ignoreControllerDir === workspaceDir) {
      return this.ignoreController
    }
    const controller = new FileIgnoreController(workspaceDir)
    await controller.initialize()
    this.ignoreController = controller
    this.ignoreControllerDir = workspaceDir
    return controller
  }

  private async gatherEditorContext(): Promise<EditorContext> {
    const workspaceDir = this.getWorkspaceDirectory()
    const controller = await this.getIgnoreController(workspaceDir)

    const toRelative = (fsPath: string): string | undefined => {
      if (!workspaceDir) {
        return undefined
      }
      const relative = path.relative(workspaceDir, fsPath)
      if (relative.startsWith("..")) {
        return undefined
      }
      return relative
    }

    // Visible files (capped to avoid bloating context, filtered through .kilocodeignore)
    const visibleFiles = vscode.window.visibleTextEditors
      .map((e) => e.document.uri)
      .filter((uri) => uri.scheme === "file")
      .map((uri) => toRelative(uri.fsPath))
      .filter((p): p is string => p !== undefined && controller.validateAccess(path.resolve(workspaceDir, p)))
      .slice(0, 200)

    // Open tabs — use instanceof TabInputText to exclude notebooks, diffs, custom editors
    const openTabSet = new Set<string>()
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri
          if (uri.scheme === "file") {
            const rel = toRelative(uri.fsPath)
            if (rel && controller.validateAccess(uri.fsPath)) {
              openTabSet.add(rel)
            }
          }
        }
      }
    }
    const openTabs = [...openTabSet].slice(0, 20)

    // Active file (also filtered through .kilocodeignore)
    const activeEditor = vscode.window.activeTextEditor
    const activeRel =
      activeEditor?.document.uri.scheme === "file" ? toRelative(activeEditor.document.uri.fsPath) : undefined
    const activeFile = activeRel && controller.validateAccess(activeEditor!.document.uri.fsPath) ? activeRel : undefined

    // Shell
    const shell = vscode.env.shell || undefined

    // Timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined

    return {
      ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
      ...(openTabs.length > 0 ? { openTabs } : {}),
      ...(activeFile ? { activeFile } : {}),
      ...(shell ? { shell } : {}),
      ...(timezone ? { timezone } : {}),
    }
  }

  /**
   * Get the workspace directory for a session.
   * Checks session directory overrides first (e.g., worktree paths), then falls back to workspace root.
   */
  private getWorkspaceDirectory(sessionId?: string): string {
    if (sessionId) {
      const dir = this.sessionDirectories.get(sessionId)
      if (dir) return dir
    }
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath
    }
    return process.cwd()
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Kilo Code",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: `.container { height: 100%; display: flex; flex-direction: column; height: 100vh; }`,
    })
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.webviewMessageDisposable?.dispose()
    this.trackedSessionIds.clear()
    this.syncedChildSessions.clear()
    this.sessionDirectories.clear()
    this.ignoreController?.dispose()
  }
}
