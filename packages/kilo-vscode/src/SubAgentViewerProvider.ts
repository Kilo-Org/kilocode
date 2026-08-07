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
    // Start accepting this session's SSE events as soon as the panel subscribes.
    // Reasoning deltas are not persisted until the reasoning part finishes.
    provider.trackSession(sessionID)
    provider.resolveWebviewPanel(panel)

    // Navigate immediately when the webview is ready, then load metadata and
    // the same paginated, row-virtualized transcript used by normal sessions.
    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type !== "webviewReady") return
      readyDisposable.dispose()

      provider.postMessage({ type: "viewSubAgentSession", sessionID })
      void provider.loadMessages(sessionID)

      try {
        const client = this.connectionService.getClient()
        void client.session
          .get({ sessionID }, { throwOnError: true })
          .then(({ data: session }) => provider.registerSession(session))
          .catch((err: unknown) => {
            console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:", err)
          })
      } catch (err) {
        console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:", err)
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
