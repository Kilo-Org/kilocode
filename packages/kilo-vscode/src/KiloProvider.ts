import * as vscode from "vscode"
import {
  ServerManager,
  HttpClient,
  SSEClient,
  type SessionInfo,
  type SSEEvent,
  type ServerConfig,
} from "./services/cli-backend"

export class KiloProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kilo-code.new.sidebarView"

  private readonly serverManager: ServerManager
  private httpClient: HttpClient | null = null
  private sseClient: SSEClient | null = null
  private webviewView: vscode.WebviewView | null = null
  private currentSession: SessionInfo | null = null
  private serverInfo: { port: number } | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0

  constructor(
    private readonly extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    this.serverManager = new ServerManager(context)
  }

  private isWebviewReady = false

  /**
   * Synchronize current extension-side state to the webview.
   * This is primarily used after a webview refresh where early postMessage calls
   * may have been dropped before the webview registered its message listeners.
   */
  private async syncWebviewState(reason: string): Promise<void> {
    console.log("[Kilo New] KiloProvider: 🔄 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasHttpClient: !!this.httpClient,
      hasSseClient: !!this.sseClient,
      hasServerInfo: !!this.serverInfo,
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
    if (this.serverInfo) {
      this.postMessage({
        type: "ready",
        serverInfo: this.serverInfo,
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
    // Store the webview reference
    this.webviewView = webviewView
    this.isWebviewReady = false

    // Set up webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          break
        case "sendMessage":
          await this.handleSendMessage(message.text, message.sessionID)
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
          this.loginAttempt++ // Invalidate in-flight login
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
      }
    })

    // Initialize connection to CLI backend
    this.initializeConnection()
  }

  /**
   * Initialize connection to the CLI backend server.
   */
  private async initializeConnection(): Promise<void> {
    console.log("[Kilo New] KiloProvider: 🔧 Starting initializeConnection...")
    try {
      // Get server from server manager
      console.log("[Kilo New] KiloProvider: 📡 Requesting server from serverManager...")
      const server = await this.serverManager.getServer()
      console.log("[Kilo New] KiloProvider: ✅ Server obtained:", { port: server.port, hasPassword: !!server.password })

      this.serverInfo = { port: server.port }

      // Create config with baseUrl and password
      const config: ServerConfig = {
        baseUrl: `http://127.0.0.1:${server.port}`,
        password: server.password,
      }
      console.log("[Kilo New] KiloProvider: 🔑 Created config:", { baseUrl: config.baseUrl })

      // Create HttpClient and SSEClient instances
      this.httpClient = new HttpClient(config)
      this.sseClient = new SSEClient(config)
      console.log("[Kilo New] KiloProvider: 🔌 Created HttpClient and SSEClient")

      // Set up SSE event handling
      this.sseClient.onEvent((event) => {
        console.log("[Kilo New] KiloProvider: 📨 Received SSE event:", event.type)
        this.handleSSEEvent(event)
      })

      this.sseClient.onStateChange(async (state) => {
        console.log("[Kilo New] KiloProvider: 🔄 SSE state changed to:", state)

        this.connectionState = state
        console.log("[Kilo New] KiloProvider: 📤 Posting connectionState message to webview:", state)
        this.postMessage({
          type: "connectionState",
          state,
        })

        // Fetch and send profile data once connected
        if (state === "connected" && this.httpClient) {
          console.log("[Kilo New] KiloProvider: 👤 Fetching profile data...")
          const profileData = await this.httpClient.getProfile()
          console.log("[Kilo New] KiloProvider: 👤 Profile data:", profileData ? "received" : "null")
          this.postMessage({
            type: "profileData",
            data: profileData,
          })

          // If the webview is already ready, also sync any state that might have been lost.
          await this.syncWebviewState("sse-connected")
        }
      })

      // Connect SSE with workspace directory
      const workspaceDir = this.getWorkspaceDirectory()
      console.log("[Kilo New] KiloProvider: 📂 Connecting SSE with workspace:", workspaceDir)
      this.sseClient.connect(workspaceDir)

      // Post "ready" message to webview with server info
      console.log("[Kilo New] KiloProvider: 📤 Posting ready message to webview")
      this.postMessage({
        type: "ready",
        serverInfo: {
          port: server.port,
        },
      })

      // In case the webview is already ready by the time we get here, sync state.
      await this.syncWebviewState("initializeConnection")
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
   * Handle sending a message from the webview.
   */
  private async handleSendMessage(text: string, sessionID?: string): Promise<void> {
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

      // Send message with text part
      await this.httpClient.sendMessage(targetSessionID, [{ type: "text", text }], workspaceDir)
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
   * Handle SSE events from the CLI backend.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Filter events by sessionID (only process events for current session)
    if ("sessionID" in event.properties) {
      const props = event.properties as { sessionID?: string }
      if (this.currentSession && props.sessionID !== this.currentSession.id) {
        return
      }
    }

    // Forward relevant events to webview
    switch (event.type) {
      case "message.part.updated": {
        // The part contains the full part data including messageID, delta is optional text delta
        const part = event.properties.part as { messageID?: string; sessionID?: string }
        const messageID = part.messageID || ""
        this.postMessage({
          type: "partUpdated",
          sessionID: part.sessionID || this.currentSession?.id,
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
    this.webviewView?.webview.postMessage(message)
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
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  /**
   * Dispose of the provider and clean up resources.
   */
  dispose(): void {
    this.sseClient?.dispose()
    this.serverManager.dispose()
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
