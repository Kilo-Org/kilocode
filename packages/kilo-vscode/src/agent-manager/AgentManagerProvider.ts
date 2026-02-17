// kilocode_change - new file
import * as vscode from "vscode"
import type { KiloConnectionService, SSEEvent } from "../services/cli-backend"
import { AgentSessionManager } from "./AgentSessionManager"
import type { AgentSession, AgentManagerMessage } from "./types"

const LOG_PREFIX = "[Agent Manager]"

/**
 * AgentManagerProvider manages the Agent Manager webview panel.
 * Opens in the main editor area with a session list + embedded sidebar iframes.
 *
 * Each agent session renders the sidebar SolidJS app inside an iframe.
 * The provider acts as a message router between iframes and kilo serve.
 */
export class AgentManagerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"

  private panel: vscode.WebviewPanel | undefined
  private disposables: vscode.Disposable[] = []
  private sessionManager: AgentSessionManager
  private unsubscribeEvent: (() => void) | null = null
  private outputChannel: vscode.OutputChannel

  // Track which session IDs we manage so we can filter SSE events
  private managedSessionIds = new Set<string>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
    this.sessionManager = new AgentSessionManager(connectionService, (session) => {
      this.postMessage({ type: "agentManager.sessionUpdated", session })
    })
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
    console.log(LOG_PREFIX, ...args)
  }

  private logError(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ERROR: ${msg}`)
    console.error(LOG_PREFIX, ...args)
  }

  public openPanel(): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.log("Opening Agent Manager panel")

    this.panel = vscode.window.createWebviewPanel(
      AgentManagerProvider.viewType,
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.panel.webview.html = this.getAgentManagerHtml(this.panel.webview)

    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables)

    this.panel.onDidDispose(
      () => {
        this.disposables.forEach((d) => d.dispose())
        this.disposables = []
        this.panel = undefined
      },
      null,
      this.disposables,
    )

    // Subscribe to SSE events for all managed sessions
    this.subscribeToSSE()
  }

  private subscribeToSSE() {
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = this.connectionService.onEventFiltered(
      (event) => {
        const id = this.connectionService.resolveEventSessionId(event)
        return id ? this.managedSessionIds.has(id) : false
      },
      (event) => this.handleSSEEvent(event),
    )
  }

  /**
   * Handle SSE events and route them to the correct iframe via the webview.
   * We translate SSE events into the same ExtensionMessage format that
   * KiloProvider uses, so the sidebar iframe receives them identically.
   */
  private handleSSEEvent(event: SSEEvent) {
    const sessionId = this.connectionService.resolveEventSessionId(event)
    if (!sessionId || !this.managedSessionIds.has(sessionId)) return

    // Translate SSE event to ExtensionMessage format (same as KiloProvider.handleSSEEvent)
    const payload = this.translateSSEToExtensionMessage(event, sessionId)
    if (!payload) return

    this.postMessage({ type: "agentManager.sidebarEvent", sessionId, payload })

    // Also update session status in the overview
    if (event.type === "session.status") {
      const session = this.sessionManager.getSession(sessionId)
      if (session) {
        this.postMessage({ type: "agentManager.sessionUpdated", session })
      }
    }
  }

  /**
   * Translate an SSE event into the ExtensionMessage format the sidebar expects.
   * This mirrors KiloProvider.handleSSEEvent() logic.
   */
  private translateSSEToExtensionMessage(event: SSEEvent, sessionId: string): unknown {
    const props = event.properties as Record<string, unknown>
    switch (event.type) {
      case "message.part.updated": {
        const part = props.part as Record<string, unknown>
        return {
          type: "partUpdated",
          sessionID: sessionId,
          messageID: part.messageID || "",
          part: props.part,
          delta: props.delta ? { type: "text-delta", textDelta: props.delta } : undefined,
        }
      }
      case "message.updated": {
        const info = props.info as Record<string, unknown>
        const time = info.time as Record<string, unknown>
        return {
          type: "messageCreated",
          message: {
            id: info.id,
            sessionID: info.sessionID,
            role: info.role,
            createdAt: new Date(time.created as number).toISOString(),
            cost: info.cost,
            tokens: info.tokens,
          },
        }
      }
      case "session.status":
        return {
          type: "sessionStatus",
          sessionID: props.sessionID,
          status: (props.status as Record<string, unknown>)?.type,
        }
      case "permission.asked":
        return {
          type: "permissionRequest",
          permission: {
            id: props.id,
            sessionID: props.sessionID,
            toolName: props.permission,
            args: props.metadata,
            message: `Permission required: ${props.permission}`,
            tool: props.tool,
          },
        }
      case "todo.updated":
        return {
          type: "todoUpdated",
          sessionID: props.sessionID,
          items: props.items,
        }
      case "question.asked":
        return {
          type: "questionRequest",
          question: {
            id: props.id,
            sessionID: props.sessionID,
            questions: props.questions,
            tool: props.tool,
          },
        }
      case "question.replied":
      case "question.rejected":
        return {
          type: "questionResolved",
          requestID: props.requestID,
        }
      case "session.created": {
        const info = props.info as Record<string, unknown>
        const time = info.time as Record<string, unknown>
        return {
          type: "sessionCreated",
          session: {
            id: info.id,
            title: info.title,
            createdAt: new Date(time.created as number).toISOString(),
            updatedAt: new Date(time.updated as number).toISOString(),
          },
        }
      }
      case "session.updated": {
        const info = props.info as Record<string, unknown>
        const time = info.time as Record<string, unknown>
        return {
          type: "sessionUpdated",
          session: {
            id: info.id,
            title: info.title,
            createdAt: new Date(time.created as number).toISOString(),
            updatedAt: new Date(time.updated as number).toISOString(),
          },
        }
      }
      default:
        return null
    }
  }

  private async handleMessage(msg: AgentManagerMessage) {
    switch (msg.type) {
      case "agentManager.ready":
        this.log("Webview ready, sending sidebar asset URIs and sessions")
        this.sendSidebarAssets()
        this.postMessage({
          type: "agentManager.sessions",
          sessions: this.sessionManager.getAllSessions(),
        })
        break

      case "agentManager.createSession":
        this.log("Creating session with prompt:", msg.prompt.slice(0, 80))
        await this.handleCreateSession(msg.prompt)
        break

      case "agentManager.stopSession":
        await this.sessionManager.stopSession(msg.sessionId, this.getWorkspaceDirectory())
        break

      case "agentManager.deleteSession":
        await this.sessionManager.deleteSession(msg.sessionId, this.getWorkspaceDirectory())
        this.managedSessionIds.delete(msg.sessionId)
        this.postMessage({ type: "agentManager.sessionDeleted", sessionId: msg.sessionId })
        break

      case "agentManager.sidebarMessage":
        await this.handleSidebarMessage(msg.sessionId, msg.payload)
        break
    }
  }

  private async handleCreateSession(prompt: string) {
    const directory = this.getWorkspaceDirectory()

    try {
      const session = await this.sessionManager.createSession(prompt, directory)
      this.managedSessionIds.add(session.id)
      this.log("Session created:", session.id)

      // Send the initial prompt
      await this.sessionManager.sendPrompt(session.id, prompt, directory)
      this.log("Initial prompt sent for session:", session.id)

      this.postMessage({ type: "agentManager.sessionCreated", session })

      // Also send initial data to the iframe (providers, agents, config, connection state)
      this.sendInitialDataForSession(session.id)
    } catch (error) {
      this.logError("Failed to create session:", error)
      this.postMessage({
        type: "agentManager.error",
        message: error instanceof Error ? error.message : "Failed to create session",
      })
    }
  }

  /**
   * Send the initial data that the sidebar iframe needs to initialize.
   * This mirrors what KiloProvider.initializeConnection() + syncWebviewState() does.
   */
  private async sendInitialDataForSession(sessionId: string) {
    try {
      const client = this.connectionService.getHttpClient()
      const directory = this.getWorkspaceDirectory()
      const serverInfo = this.connectionService.getServerInfo()

      // Send connection state + ready
      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
        this.postMessage({
          type: "agentManager.sidebarEvent",
          sessionId,
          payload: {
            type: "ready",
            serverInfo,
            vscodeLanguage: vscode.env.language,
            languageOverride: langConfig.get<string>("language"),
          },
        })
      }

      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: {
          type: "connectionState",
          state: this.connectionService.getConnectionState(),
        },
      })

      // Send providers
      const providers = await client.listProviders(directory)
      const normalized: Record<string, unknown> = {}
      for (const provider of Object.values(providers.all)) {
        const p = provider as { id: string }
        normalized[p.id] = provider
      }
      const config = vscode.workspace.getConfiguration("kilo-code.new.model")
      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: {
          type: "providersLoaded",
          providers: normalized,
          connected: providers.connected,
          defaults: providers.default,
          defaultSelection: {
            providerID: config.get<string>("providerID", "kilo"),
            modelID: config.get<string>("modelID", "kilo/auto"),
          },
        },
      })

      // Send agents
      const agents = await client.listAgents(directory)
      const visible = agents.filter((a: { mode: string; hidden?: boolean }) => a.mode !== "subagent" && !a.hidden)
      const defaultAgent = visible.length > 0 ? (visible[0] as { name: string }).name : "code"
      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: {
          type: "agentsLoaded",
          agents: visible.map(
            (a: { name: string; description?: string; mode: string; native?: boolean; color?: string }) => ({
              name: a.name,
              description: a.description,
              mode: a.mode,
              native: a.native,
              color: a.color,
            }),
          ),
          defaultAgent,
        },
      })

      // Send config
      const backendConfig = await client.getConfig(directory)
      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: { type: "configLoaded", config: backendConfig },
      })

      // Tell the sidebar about this session so it can select it
      const sessionInfo = await client.getSession(sessionId, directory)
      if (sessionInfo) {
        this.postMessage({
          type: "agentManager.sidebarEvent",
          sessionId,
          payload: {
            type: "sessionsLoaded",
            sessions: [
              {
                id: sessionInfo.id,
                title: sessionInfo.title,
                createdAt: new Date(sessionInfo.time.created).toISOString(),
                updatedAt: new Date(sessionInfo.time.updated).toISOString(),
              },
            ],
          },
        })
      }

      // Load messages for this session
      const messages = await client.getMessages(sessionId, directory)
      const mapped = messages.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
        cost: m.info.cost,
        tokens: m.info.tokens,
      }))
      for (const message of mapped) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: { type: "messagesLoaded", sessionID: sessionId, messages: mapped },
      })

      // Navigate the sidebar to the chat view for this session
      this.postMessage({
        type: "agentManager.sidebarEvent",
        sessionId,
        payload: { type: "navigate", view: "newTask" },
      })
    } catch (error) {
      this.logError("Failed to send initial data for session:", error)
    }
  }

  /**
   * Handle messages coming from a sidebar iframe, routed through the Agent Manager webview.
   * These are the same WebviewMessage types that KiloProvider handles.
   */
  private async handleSidebarMessage(sessionId: string, payload: unknown) {
    const msg = payload as Record<string, unknown>
    const client = this.connectionService.getHttpClient()
    const directory = this.getWorkspaceDirectory()

    switch (msg.type) {
      case "webviewReady":
        // Iframe loaded -- send initial data
        this.sendInitialDataForSession(sessionId)
        break

      case "sendMessage": {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []
        if (msg.files) {
          for (const f of msg.files as Array<{ mime: string; url: string }>) {
            parts.push({ type: "file", mime: f.mime, url: f.url })
          }
        }
        parts.push({ type: "text", text: msg.text as string })
        await client.sendMessage((msg.sessionID as string) || sessionId, parts, directory, {
          providerID: msg.providerID as string | undefined,
          modelID: msg.modelID as string | undefined,
          agent: msg.agent as string | undefined,
        })
        break
      }

      case "abort":
        await client.abortSession((msg.sessionID as string) || sessionId, directory)
        break

      case "permissionResponse":
        await client.respondToPermission(
          (msg.sessionID as string) || sessionId,
          msg.permissionId as string,
          msg.response as "once" | "always" | "reject",
          directory,
        )
        break

      case "loadMessages": {
        const messages = await client.getMessages(msg.sessionID as string, directory)
        const mapped = messages.map((m) => ({
          id: m.info.id,
          sessionID: m.info.sessionID,
          role: m.info.role,
          parts: m.parts,
          createdAt: new Date(m.info.time.created).toISOString(),
          cost: m.info.cost,
          tokens: m.info.tokens,
        }))
        for (const message of mapped) {
          this.connectionService.recordMessageSessionId(message.id, message.sessionID)
        }
        this.postMessage({
          type: "agentManager.sidebarEvent",
          sessionId,
          payload: { type: "messagesLoaded", sessionID: msg.sessionID, messages: mapped },
        })
        break
      }

      case "loadSessions": {
        const sessions = await client.listSessions(directory)
        const mapped = sessions.map(
          (s: { id: string; title?: string; time: { created: number; updated: number } }) => ({
            id: s.id,
            title: s.title,
            createdAt: new Date(s.time.created).toISOString(),
            updatedAt: new Date(s.time.updated).toISOString(),
          }),
        )
        this.postMessage({
          type: "agentManager.sidebarEvent",
          sessionId,
          payload: { type: "sessionsLoaded", sessions: mapped },
        })
        break
      }

      case "compact":
        await client.summarize(
          (msg.sessionID as string) || sessionId,
          msg.providerID as string,
          msg.modelID as string,
          directory,
        )
        break

      case "requestProviders":
      case "requestAgents":
      case "requestConfig":
        // Re-send initial data
        this.sendInitialDataForSession(sessionId)
        break

      case "questionReply":
        await client.replyToQuestion(msg.requestID as string, msg.answers as string[][], directory)
        break

      case "questionReject":
        await client.rejectQuestion(msg.requestID as string, directory)
        break

      case "updateConfig": {
        const updated = await client.updateConfig(msg.config as Record<string, unknown>)
        this.postMessage({
          type: "agentManager.sidebarEvent",
          sessionId,
          payload: { type: "configUpdated", config: updated },
        })
        break
      }
    }
  }

  /**
   * Send the webview URIs for the sidebar JS/CSS so the webview can fetch them
   * directly and construct the iframe HTML itself.
   * This avoids sending 20MB via postMessage and avoids CSP issues with inline scripts.
   */
  private sendSidebarAssets() {
    if (!this.panel) return
    const webview = this.panel.webview
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")).toString()
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")).toString()
    const iconDarkUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"))
      .toString()
    const iconLightUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"))
      .toString()
    this.log("Sending sidebar asset URIs")
    this.postMessage({ type: "agentManager.sidebarAssets", jsUri, cssUri, iconDarkUri, iconLightUri })
  }

  private postMessage(msg: unknown) {
    this.panel?.webview.postMessage(msg)
  }

  private getWorkspaceDirectory(): string {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) return folders[0].uri.fsPath
    return process.cwd()
  }

  private getAgentManagerHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js"))
    const nonce = getNonce()

    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource} blob:`,
      `script-src 'nonce-${nonce}' blob:`,
      `frame-src blob:`,
      `connect-src ${webview.cspSource}`,
      `font-src ${webview.cspSource} blob:`,
      `img-src ${webview.cspSource} data: https: blob:`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Agent Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root { height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  public dispose(): void {
    this.panel?.dispose()
    this.disposables.forEach((d) => d.dispose())
    this.disposables = []
    this.unsubscribeEvent?.()
    this.sessionManager.dispose()
    this.outputChannel.dispose()
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
