import * as vscode from "vscode"
import { z } from "zod"
import { type HttpClient, type SessionInfo, type SSEEvent, type KiloConnectionService } from "./services/cli-backend"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"

export class KiloProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kilo-code.new.sidebarView"

  private webview: vscode.Webview | null = null
  private currentSession: SessionInfo | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  /** Cached providersLoaded payload so requestProviders can be served before httpClient is ready */
  private cachedProvidersMessage: unknown = null
  /** Cached agentsLoaded payload so requestAgents can be served before httpClient is ready */
  private cachedAgentsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before httpClient is ready */
  private cachedConfigMessage: unknown = null

  private trackedSessionIds: Set<string> = new Set()
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {}

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
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
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
   * Set up the shared message handler for both sidebar and tab webviews.
   * Handles ALL message types so tabs have full functionality.
   */
  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          break
        case "sendMessage": {
          const files = z
            .array(z.object({ mime: z.string(), url: z.string().startsWith("file://") }))
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendMessage(
            message.text,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
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
          break
        case "loadMessages":
          await this.handleLoadMessages(message.sessionID)
          break
        case "loadSessions":
          await this.handleLoadSessions()
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
        case "requestProviders":
          await this.fetchAndSendProviders()
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestAgents":
          await this.fetchAndSendAgents()
          break
        case "questionReply":
          await this.handleQuestionReply(message.requestID, message.answers)
          break
        case "questionReject":
          await this.handleQuestionReject(message.requestID)
          break
        case "requestConfig":
          await this.fetchAndSendConfig()
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

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (event) => {
          const sessionId = this.connectionService.resolveEventSessionId(event)

          // message.part.updated is always session-scoped; if we can't determine the session, drop it.
          if (!sessionId) {
            return event.type !== "message.part.updated"
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
          } catch (error) {
            console.error("[Kilo New] KiloProvider: ❌ Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : "Failed to sync after connecting",
            })
          }
        }
      })

      // Get current state and push to webview
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = this.connectionService.getConnectionState()

      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
        this.postMessage({
          type: "ready",
          serverInfo,
          vscodeLanguage: vscode.env.language,
          languageOverride: langConfig.get<string>("language"),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      await this.syncWebviewState("initializeConnection")

      // Fetch providers and agents, then send to webview
      await this.fetchAndSendProviders()
      await this.fetchAndSendAgents()
      await this.fetchAndSendConfig()
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

  /**
   * Convert SessionInfo to webview format.
   */
  private sessionToWebview(session: SessionInfo) {
    return {
      id: session.id,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
    }
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
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const messagesData = await this.httpClient.getMessages(sessionID, workspaceDir)

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching to a historical session.
      // Non-blocking: don't let a failure here prevent messages from loading.
      this.httpClient
        .getSession(sessionID, workspaceDir)
        .then((session) => {
          if (!this.currentSession || this.currentSession.id === sessionID) {
            this.currentSession = session
          }
        })
        .catch((err) => console.error("[Kilo New] KiloProvider: Failed to fetch session for tracking:", err))

      // Convert to webview format, including cost/tokens for assistant messages
      const messages = messagesData.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
        cost: m.info.cost,
        tokens: m.info.tokens,
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
      console.error("[Kilo New] KiloProvider: Failed to load messages:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load messages",
      })
    }
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const sessions = await this.httpClient.listSessions(workspaceDir)

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
      const workspaceDir = this.getWorkspaceDirectory()
      await this.httpClient.deleteSession(sessionID, workspaceDir)
      this.trackedSessionIds.delete(sessionID)
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
      const workspaceDir = this.getWorkspaceDirectory()
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

      // Re-key providers from numeric indices to provider.id
      const normalized: typeof response.all = {}
      for (const provider of Object.values(response.all)) {
        normalized[provider.id] = provider
      }

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

      // Filter to only visible primary/all modes (not subagents, not hidden)
      const visible = agents.filter((a) => a.mode !== "subagent" && !a.hidden)

      // Find default agent: first one in list (CLI sorts default first)
      const defaultAgent = visible.length > 0 ? visible[0].name : "code"

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
      const workspaceDir = this.getWorkspaceDirectory()

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

      // Inject active editor file as context
      const editor = vscode.window.activeTextEditor
      if (editor && editor.document.uri.scheme === "file") {
        const url = editor.document.uri.toString()
        const already = files?.some((f) => f.url === url)
        if (!already) {
          parts.push({ type: "file", mime: "text/plain", url })
        }
      }

      // Add any explicitly attached files from the webview
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url })
        }
      }

      parts.push({ type: "text", text })

      await this.httpClient.sendMessage(targetSessionID, parts, workspaceDir, {
        providerID,
        modelID,
        agent,
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
      const workspaceDir = this.getWorkspaceDirectory()
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
      const workspaceDir = this.getWorkspaceDirectory()
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
      const workspaceDir = this.getWorkspaceDirectory()
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
      await this.httpClient.replyToQuestion(requestID, answers, this.getWorkspaceDirectory())
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
      await this.httpClient.rejectQuestion(requestID, this.getWorkspaceDirectory())
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
    const parts = key.split(".")
    const section = parts.slice(0, -1).join(".")
    const leaf = parts[parts.length - 1]
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    await config.update(leaf, value, vscode.ConfigurationTarget.Global)
  }

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
   * Filters events by tracked session IDs so each webview only sees its own sessions.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.updated is always session-scoped; if we can't determine the session, drop it to avoid cross-webview leakage.
    if (!sessionID && event.type === "message.part.updated") {
      return
    }
    if (sessionID && !this.trackedSessionIds.has(sessionID)) {
      return
    }

    // Forward relevant events to webview
    switch (event.type) {
      case "message.part.updated": {
        // The part contains the full part data including messageID, delta is optional text delta
        const part = event.properties.part as { messageID?: string; sessionID?: string }
        const messageID = part.messageID || ""

        const resolvedSessionID = sessionID
        if (!resolvedSessionID) {
          return
        }
        this.postMessage({
          type: "partUpdated",
          sessionID: resolvedSessionID,
          messageID,
          part: event.properties.part,
          delta: event.properties.delta ? { type: "text-delta", textDelta: event.properties.delta } : undefined,
        })
        break
      }

      case "message.updated":
        // Message info updated — forward cost/tokens for assistant messages
        this.postMessage({
          type: "messageCreated",
          message: {
            id: event.properties.info.id,
            sessionID: event.properties.info.sessionID,
            role: event.properties.info.role,
            createdAt: new Date(event.properties.info.time.created).toISOString(),
            cost: event.properties.info.cost,
            tokens: event.properties.info.tokens,
          },
        })
        break

      case "session.status":
        this.postMessage({
          type: "sessionStatus",
          sessionID: event.properties.sessionID,
          status: event.properties.status.type,
        })
        break

      case "permission.asked":
        this.postMessage({
          type: "permissionRequest",
          permission: {
            id: event.properties.id,
            sessionID: event.properties.sessionID,
            toolName: event.properties.permission,
            args: event.properties.metadata,
            message: `Permission required: ${event.properties.permission}`,
            tool: event.properties.tool,
          },
        })
        break

      case "todo.updated":
        this.postMessage({
          type: "todoUpdated",
          sessionID: event.properties.sessionID,
          items: event.properties.items,
        })
        break

      case "question.asked":
        this.postMessage({
          type: "questionRequest",
          question: {
            id: event.properties.id,
            sessionID: event.properties.sessionID,
            questions: event.properties.questions,
            tool: event.properties.tool,
          },
        })
        break

      case "question.replied":
        this.postMessage({
          type: "questionResolved",
          requestID: event.properties.requestID,
        })
        break

      case "question.rejected":
        this.postMessage({
          type: "questionResolved",
          requestID: event.properties.requestID,
        })
        break

      case "session.created":
        // Store session if we don't have one yet
        if (!this.currentSession) {
          this.currentSession = event.properties.info
          this.trackedSessionIds.add(event.properties.info.id)
        }
        // Notify webview
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(event.properties.info),
        })
        break

      case "session.updated":
        // Keep local state in sync (e.g. title generation)
        if (this.currentSession?.id === event.properties.info.id) {
          this.currentSession = event.properties.info
        }
        this.postMessage({
          type: "sessionUpdated",
          session: this.sessionToWebview(event.properties.info),
        })
        break
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
   * Get the workspace directory.
   */
  private getWorkspaceDirectory(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath
    }
    return process.cwd()
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"))
    const iconsBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons"))

    const nonce = getNonce()

    // CSP allows:
    // - default-src 'none': Block everything by default
    // - style-src: Allow inline styles and our CSS file
    // - script-src 'nonce-...': Only allow scripts with our nonce
    // - connect-src: Allow connections to localhost for API calls
    // - img-src: Allow images from webview and data URIs
    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `font-src ${webview.cspSource}`,
      "connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
      `img-src ${webview.cspSource} data: https:`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>Kilo Code</title>
	<link rel="stylesheet" href="${styleUri}">
	<style>
		html, body {
			margin: 0;
			padding: 0;
			height: 100%;
			overflow: hidden;
		}
		body {
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
		}
		#root {
			height: 100%;
		}
		.container {
			height: 100%;
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">window.ICONS_BASE_URI = "${iconsBaseUri}";</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.webviewMessageDisposable?.dispose()
    this.trackedSessionIds.clear()
  }
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
