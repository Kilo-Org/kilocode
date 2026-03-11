import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { resolvePanelProjectDirectory } from "./panel-workspace"
import type { KiloConnectionService } from "./services/cli-backend"

type PanelView = "settings" | "profile" | "marketplace"

const PANEL_TITLES: Record<PanelView, string> = {
  settings: "Kilo Settings",
  profile: "Kilo Profile",
  marketplace: "Kilo Marketplace",
}

/**
 * Opens Settings, Profile, or Marketplace as an editor-area WebviewPanel,
 * keeping the sidebar chat undisturbed.
 *
 * Each view type is a singleton panel — calling openPanel() again
 * reveals the existing panel instead of creating a duplicate.
 *
 * Uses a full KiloProvider under the hood so each panel has
 * the same backend connectivity (config, providers, profile, auth)
 * as the sidebar.
 */
export class SettingsEditorProvider implements vscode.Disposable {
  private panels = new Map<PanelView, vscode.WebviewPanel>()
  private providers = new Map<PanelView, KiloProvider>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  private getProjectDirectory(): string | null {
    const editor = vscode.window.activeTextEditor
    const active =
      editor?.document.uri.scheme === "file"
        ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
        : undefined
    return resolvePanelProjectDirectory(active, vscode.workspace.workspaceFolders)
  }

  openPanel(view: PanelView): void {
    const projectDirectory = this.getProjectDirectory()
    const existing = this.panels.get(view)
    if (existing) {
      this.providers.get(view)?.setProjectDirectory(projectDirectory)
      existing.reveal(vscode.ViewColumn.One)
      return
    }

    const title = PANEL_TITLES[view]

    const panel = vscode.window.createWebviewPanel(`kilo-code.new.${view}Panel`, title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    // Create a dedicated KiloProvider for this panel so it has full
    // backend connectivity (config, providers, agents, profile, auth).
    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context, {
      projectDirectory,
    })
    provider.resolveWebviewPanel(panel)

    // Listen for closePanel from the webview (back button in panel mode)
    const closePanelDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        panel.dispose()
      }
    })

    // Once the webview signals ready, navigate to the target view.
    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "webviewReady") {
        // Small delay to let KiloProvider's own webviewReady handler finish first
        setTimeout(() => {
          provider.postMessage({ type: "navigate", view })
        }, 50)
        readyDisposable.dispose()
      }
    })

    this.panels.set(view, panel)
    this.providers.set(view, provider)

    panel.onDidDispose(() => {
      console.log(`[Kilo New] ${title} panel disposed`)
      closePanelDisposable.dispose()
      provider.dispose()
      this.panels.delete(view)
      this.providers.delete(view)
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
