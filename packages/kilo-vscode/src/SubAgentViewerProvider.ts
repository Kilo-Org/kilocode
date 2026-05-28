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

    // Once the webview is ready, fetch the session and display it in read-only mode.
    const readyDisposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type !== "webviewReady") return
      readyDisposable.dispose()

      // Small delay to let KiloProvider's own webviewReady handler finish first
      await new Promise((resolve) => setTimeout(resolve, 50))

      try {
        const client = this.connectionService.getClient()
        const { data: session } = await client.session.get({ sessionID }, { throwOnError: true })

        // Register the session on the provider — this adds it to
        // trackedSessionIds for live SSE updates and sends
        // sessionCreated to the webview.
        provider.registerSession(session)

        // Fetch the newest page before navigating so the tab opens on the latest turn.
        await provider.loadMessages(sessionID)

        // Navigate to the sub-agent viewer
        provider.postMessage({ type: "viewSubAgentSession", sessionID })
      } catch (err) {
        console.error("[Kilo New] SubAgentViewerProvider: Failed to load session:", err)
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
