import * as vscode from "vscode"
import { type HttpClient, type SessionInfo, type SSEEvent, type KiloConnectionService } from "./services/cli-backend"

export class KiloProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kilo-code.new.sidebarView"

  private webview: vscode.Webview | null = null
  private currentSession: SessionInfo | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  /** Cached providersLoaded payload so requestProviders can be served before httpClient is ready */
  private cachedProvidersMessage: unknown = null

  private trackedSessionIds: Set<string> = new Set()
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private devReloadWatcher: vscode.FileSystemWatcher | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production,
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
      this.postMessage({
        type: "ready",
        serverInfo,
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

    // In development, watch for webview dist changes and auto-reload
    if (this.extensionMode === vscode.ExtensionMode.Development) {
      this.setupDevReload(webviewView.webview)
    }

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

    // In development, watch for webview dist changes and auto-reload
    if (this.extensionMode === vscode.ExtensionMode.Development) {
      this.setupDevReload(panel.webview)
    }

    this.initializeConnection()
  }

  /**
   * Watch for changes to the webview dist files and auto-reload the webview.
   * Only active in development mode so changes during `pnpm watch` are
   * reflected without manually reloading the extension host window.
   */
  private setupDevReload(webview: vscode.Webview): void {
    this.devReloadWatcher?.dispose()

    const pattern = new vscode.RelativePattern(vscode.Uri.joinPath(this.extensionUri, "dist"), "webview.*")
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)

    const reload = () => {
      console.log("[Kilo New] KiloProvider: 🔄 Dev reload — webview dist changed, reloading HTML")
      webview.html = ""
      webview.html = this._getHtmlForWebview(webview)
    }

    watcher.onDidChange(reload)
    watcher.onDidCreate(reload)

    this.devReloadWatcher = watcher
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
        case "sendMessage":
          await this.handleSendMessage(message.text, message.sessionID, message.providerID, message.modelID)
          break
        case "abort":
          await this.handleAbort(message.sessionID)
          break
        case "permissionResponse":
          await this.handlePermissionResponse(message.permissionId, message.sessionID, message.response)
          break
        case "createSession":
          await this.handleCreateSession()
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
        this.postMessage({ type: "ready", serverInfo })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      await this.syncWebviewState("initializeConnection")

      // Fetch providers and send to webview
      await this.fetchAndSendProviders()

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

      // Convert to webview format
      const messages = messagesData.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
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
   * Handle sending a message from the webview.
   */
  private async handleSendMessage(
    text: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
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

      // Send message with text part and optional model selection
      await this.httpClient.sendMessage(targetSessionID, [{ type: "text", text }], workspaceDir, {
        providerID,
        modelID,
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
        // Message info updated
        this.postMessage({
          type: "messageCreated",
          message: {
            id: event.properties.info.id,
            sessionID: event.properties.info.sessionID,
            role: event.properties.info.role,
            createdAt: new Date(event.properties.info.time.created).toISOString(),
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
    }
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

    const nonce = getNonce()
    // Cache-bust so the browser inside the webview doesn't serve stale bundles
    // after a rebuild (especially useful during development with watch mode).
    const bust = Date.now()

    // CSP allows:
    // - default-src 'none': Block everything by default
    // - style-src: Allow inline styles and our CSS file
    // - script-src 'nonce-...': Only allow scripts with our nonce
    // - connect-src: Allow connections to localhost for API calls
    // - img-src: Allow images from webview and data URIs
    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      "connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
      `img-src ${webview.cspSource} data: https:`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en">
<head>
 <meta charset="UTF-8">
 <meta name="viewport" content="width=device-width, initial-scale=1.0">
 <meta http-equiv="Content-Security-Policy" content="${csp}">
 <title>Kilo Code</title>
 <link rel="stylesheet" href="${styleUri}?v=${bust}">
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
 <script nonce="${nonce}" src="${scriptUri}?v=${bust}"></script>
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
    this.devReloadWatcher?.dispose()
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
