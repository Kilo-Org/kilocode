import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import type { KiloConnectionService } from "./services/cli-backend"

/**
 * Opens a read-only editor panel to view a sub-agent session.
 *
 * Each child session ID maps to at most one panel — calling openPanel()
 * again with the same ID reveals the existing panel.
 *
 * Uses a full KiloProvider so the viewer has backend connectivity
 * (messages, parts, SSE events) identical to the sidebar.
 */
export class SubAgentViewerProvider implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>()
  private providers = new Map<string, KiloProvider>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  openPanel(sessionID: string, title?: string): void {
    const existing = this.panels.get(sessionID)
    if (existing) {
      existing.reveal(vscode.ViewColumn.One)
      return
    }

    const label = title ? `Sub-agent: ${title}` : "Sub-agent Viewer"

    const panel = vscode.window.createWebviewPanel("kilo-code.new.SubAgentViewerPanel", label, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context)
    provider.resolveWebviewPanel(panel)

    // Once the webview is ready AND the backend is connected, fetch the session
    // and display it in read-only mode. The backend is usually already connected
    // when opening manually, but we use the same dual-signal pattern as restorePanel
    // to be robust against race conditions.
    let webviewReady = false
    let backendReady = this.connectionService.getConnectionState() === "connected"

    const tryLoadSession = async () => {
      if (!webviewReady || !backendReady) return

      readyDisposable.dispose()
      unsubscribeState()

      try {
        const client = this.connectionService.getClient()
        const { data: session } = await client.session.get({ sessionID }, { throwOnError: true })

        // Register the session on the provider — this adds it to
        // trackedSessionIds for live SSE updates and sends
        // sessionCreated to the webview.
        provider.registerSession(session)

        // Fetch and send existing messages
        const { data: messagesData } = await client.session.messages({ sessionID }, { throwOnError: true })
        const messages = messagesData.map((m) => ({
          ...m.info,
          parts: m.parts,
          createdAt: new Date(m.info.time.created).toISOString(),
        }))
        provider.postMessage({
          type: "messagesLoaded",
          sessionID,
          messages,
        })

        // Navigate to the sub-agent viewer
        provider.postMessage({ type: "viewSubAgentSession", sessionID })
      } catch (err) {
        console.error("[Kilo New] SubAgentViewerProvider: Failed to load session:", err)
      }
    }

    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type !== "webviewReady") return
      webviewReady = true
      void tryLoadSession()
    })

    const unsubscribeState = this.connectionService.onStateChange((state) => {
      if (state === "connected") {
        backendReady = true
        void tryLoadSession()
      }
    })

    // Listen for closePanel from the webview (back button)
    const closeDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        panel.dispose()
      }
    })

    this.panels.set(sessionID, panel)
    this.providers.set(sessionID, provider)

    panel.onDidDispose(() => {
      console.log("[Kilo New] Sub-agent viewer panel disposed:", sessionID)
      readyDisposable.dispose()
      unsubscribeState()
      closeDisposable.dispose()
      provider.dispose()
      this.panels.delete(sessionID)
      this.providers.delete(sessionID)
    })
  }

  /**
   * Restore a deserialized panel after VS Code reload.
   * Wires up the panel the same way openPanel() does, but reuses the
   * already-existing WebviewPanel that VS Code hands back from the serializer.
   */
  restorePanel(panel: vscode.WebviewPanel, sessionID: string): void {
    // If we already have a panel for this session, dispose the stale one
    const existing = this.panels.get(sessionID)
    if (existing) {
      existing.dispose()
    }

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context)
    provider.resolveWebviewPanel(panel)

    // Once the webview is ready AND the backend is connected, fetch the session
    // and display it in read-only mode. During restore after VS Code reload,
    // the webview fires webviewReady before the backend has finished connecting,
    // so we wait for both signals before fetching.
    let webviewReady = false
    let backendReady = this.connectionService.getConnectionState() === "connected"

    const tryLoadSession = async () => {
      if (!webviewReady || !backendReady) return

      // Clean up listeners since we only need to load once
      readyDisposable.dispose()
      unsubscribeState()

      try {
        const client = this.connectionService.getClient()
        const { data: session } = await client.session.get({ sessionID }, { throwOnError: true })

        provider.registerSession(session)

        const { data: messagesData } = await client.session.messages({ sessionID }, { throwOnError: true })
        const messages = messagesData.map((m) => ({
          ...m.info,
          parts: m.parts,
          createdAt: new Date(m.info.time.created).toISOString(),
        }))
        provider.postMessage({
          type: "messagesLoaded",
          sessionID,
          messages,
        })

        provider.postMessage({ type: "viewSubAgentSession", sessionID })
      } catch (err) {
        console.error("[Kilo New] SubAgentViewerProvider: Failed to restore session:", err)
        panel.dispose()
        return
      }
    }

    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type !== "webviewReady") return
      webviewReady = true
      void tryLoadSession()
    })

    const unsubscribeState = this.connectionService.onStateChange((state) => {
      if (state === "connected") {
        backendReady = true
        void tryLoadSession()
      }
    })

    // Listen for closePanel from the webview (back button)
    const closeDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        panel.dispose()
      }
    })

    this.panels.set(sessionID, panel)
    this.providers.set(sessionID, provider)

    panel.onDidDispose(() => {
      console.log("[Kilo New] Restored sub-agent viewer panel disposed:", sessionID)
      readyDisposable.dispose()
      unsubscribeState()
      closeDisposable.dispose()
      provider.dispose()
      this.panels.delete(sessionID)
      this.providers.delete(sessionID)
    })
  }

  dispose(): void {
    for (const [, panel] of this.panels) {
      panel.dispose()
    }
    this.panels.clear()
    this.providers.clear()
  }
}
