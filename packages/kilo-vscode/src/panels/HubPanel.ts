/**
 * Hub v2 — KiloCode Evo webview panel.
 *
 * Opens http://localhost:8095 (Hub v2 shell) inside VS Code.
 * Periodically syncs KiloCode status to Hub via /api/runtime/kilocode/sync.
 * Does NOT duplicate Hub logic — it is a thin browser frame + status reporter.
 */
import * as vscode from "vscode"

const HUB_URL = process.env.HUB_URL || "http://localhost:8095"
const SYNC_INTERVAL_MS = 30_000

export class HubPanel {
  static readonly viewType = "kilo-code.hub"
  private static _current: HubPanel | undefined

  private readonly _panel: vscode.WebviewPanel
  private _disposables: vscode.Disposable[] = []
  private _syncTimer: NodeJS.Timeout | undefined

  static open(context: vscode.ExtensionContext): HubPanel {
    if (HubPanel._current) {
      HubPanel._current._panel.reveal(vscode.ViewColumn.Beside)
      return HubPanel._current
    }
    const panel = vscode.window.createWebviewPanel(
      HubPanel.viewType,
      "Hub v2",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    )
    HubPanel._current = new HubPanel(panel, context)
    return HubPanel._current
  }

  static get current(): HubPanel | undefined {
    return HubPanel._current
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel
    this._panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "hub-icon.png")
    this._panel.webview.html = this._getHtml()

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables)

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.type === "hub.ready") {
          await this._syncStatus()
        }
      },
      null,
      this._disposables
    )

    this._syncTimer = setInterval(() => this._syncStatus(), SYNC_INTERVAL_MS)
    void this._syncStatus()
  }

  private async _syncStatus(): Promise<void> {
    try {
      const ext = vscode.extensions.getExtension("kilo-code")
      const version = ext?.packageJSON?.version ?? "unknown"
      await fetch(`${HUB_URL}/api/runtime/kilocode/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, synced: true }),
      })
    } catch {
      // Hub not running — silent fail
    }
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
<style>
  html, body, iframe { margin:0; padding:0; width:100%; height:100%; border:none; background:#0d1117; }
  #err { display:none; padding:20px; color:#8b949e; font-family:-apple-system,sans-serif; font-size:13px; }
</style>
</head>
<body>
<iframe id="hub" src="${HUB_URL}" onload="document.getElementById('err').style.display='none'"
        onerror="document.getElementById('err').style.display='block'"></iframe>
<div id="err">
  <h3 style="color:#e6edf3">Hub v2 not running</h3>
  <p>Start Hub with: <code style="background:#161b22;padding:2px 6px;border-radius:3px">python src/webui/hub_start.py</code></p>
  <p style="margin-top:8px">Expected at: <a href="${HUB_URL}" style="color:#60a5fa">${HUB_URL}</a></p>
</div>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('hub').addEventListener('load', () => {
    vscode.postMessage({ type: 'hub.ready' });
  });
</script>
</body>
</html>`
  }

  private _dispose(): void {
    HubPanel._current = undefined
    if (this._syncTimer) clearInterval(this._syncTimer)
    this._panel.dispose()
    this._disposables.forEach(d => d.dispose())
    this._disposables = []
  }
}
