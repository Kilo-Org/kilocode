/**
 * VS Code adapter implementing the Host interface.
 *
 * This file is on the architecture test allowlist — it is one of the few
 * agent-manager files permitted to import "vscode".
 */

import * as vscode from "vscode"
import type { Host, PanelContext, OutputHandle, SessionProvider, Disposable } from "./host"
import type { KiloConnectionService } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { openFileInEditor, getWorkspaceRoot } from "../review-utils"
import { TelemetryProxy, type TelemetryEventName } from "../services/telemetry"

export class VscodeHost implements Host {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  openPanel(opts: {
    onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  }): PanelContext {
    const panel = vscode.window.createWebviewPanel(
      "kilo-code.new.AgentManagerPanel",
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    return this.wirePanel(panel, opts)
  }

  /** Wrap an existing vscode.WebviewPanel (e.g. deserialized on restart). */
  wrapExistingPanel(
    panel: vscode.WebviewPanel,
    opts: {
      onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    },
  ): PanelContext {
    return this.wirePanel(panel, opts)
  }

  private wirePanel(
    panel: vscode.WebviewPanel,
    opts: {
      onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    },
  ): PanelContext {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    const port = this.connectionService.getServerInfo()?.port
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Agent Manager",
      port,
    })

    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context, {
      slimEditMetadata: true,
    })
    provider.attachToWebview(panel.webview, {
      onBeforeMessage: opts.onBeforeMessage,
    })

    const sessions: SessionProvider = {
      setSessionDirectory: (id, dir) => provider.setSessionDirectory(id, dir),
      clearSessionDirectory: (id) => provider.clearSessionDirectory(id),
      getSessionDirectories: () => provider.getSessionDirectories(),
      trackSession: (id) => provider.trackSession(id),
      refreshSessions: () => provider.refreshSessions(),
      registerSession: (s) => provider.registerSession(s),
      dispose: () => provider.dispose(),
    }

    return {
      get active() {
        return panel.active
      },
      postMessage(msg) {
        void panel.webview.postMessage(msg)
      },
      reveal(preserveFocus) {
        panel.reveal(vscode.ViewColumn.One, preserveFocus ?? false)
      },
      sessions,
      onDidDispose(cb) {
        return panel.onDidDispose(cb)
      },
      dispose() {
        provider.dispose()
        panel.dispose()
      },
    }
  }

  workspacePath(): string | undefined {
    return getWorkspaceRoot()
  }

  showError(msg: string): void {
    void vscode.window.showErrorMessage(msg)
  }

  async openDocument(path: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(path)
      await vscode.window.showTextDocument(doc)
    } catch {
      // Silently ignore — file may not exist
    }
  }

  openFile(path: string, line?: number, column?: number): void {
    openFileInEditor(path, line, column, vscode.ViewColumn.Active, "AgentManagerProvider")
  }

  openFolder(path: string, newWindow: boolean): void {
    const uri = vscode.Uri.file(path)
    void vscode.commands.executeCommand("vscode.openFolder", uri, newWindow)
  }

  createOutput(name: string): OutputHandle {
    const channel = vscode.window.createOutputChannel(name)
    return {
      appendLine: (msg) => channel.appendLine(msg),
      dispose: () => channel.dispose(),
    }
  }

  extensionKeybindings(): Array<{ command: string; key?: string; mac?: string }> {
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    return ext?.packageJSON?.contributes?.keybindings ?? []
  }

  serverPort(): number | undefined {
    return this.connectionService.getServerInfo()?.port
  }

  capture(event: string, properties?: Record<string, unknown>): void {
    TelemetryProxy.capture(event as TelemetryEventName, properties)
  }

  refreshGit(): void {
    // Trigger VS Code's built-in git extension to re-scan repositories.
    // This picks up worktrees whose gitdir refs were just rewritten by migration.
    void vscode.commands.executeCommand("git.refresh")
  }

  dispose(): void {}
}
