import * as vscode from "vscode"
import { callbackUri, login, authSession } from "./auth"
import { loginHtml } from "./login-html"

export type LoginHost = {
  context: vscode.ExtensionContext
  engineUrl: () => string
  onLogout: () => Promise<void>
}

export class LoginProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

  constructor(private readonly host: LoginHost) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg))
    void this.render(webviewView.webview)
  }

  refresh(): void {
    const webview = this.view?.webview
    if (webview) void this.render(webview)
  }

  private async render(webview: vscode.Webview): Promise<void> {
    const s = await authSession(this.host.context)
    webview.html = loginHtml(webview, {
      gateway: s.gateway,
      platform: s.platform,
      loggedIn: s.loggedIn,
      userId: s.userId,
      engine: this.host.engineUrl(),
      callback: callbackUri(this.host.context),
    })
  }

  private async onMessage(msg: { type?: string; gateway?: string; platform?: string }): Promise<void> {
    if (msg.type === "login") {
      await this.saveUrls(msg.gateway, msg.platform)
      await login(this.host.context)
      return
    }
    if (msg.type === "logout") {
      await this.host.onLogout()
      this.refresh()
      return
    }
    if (msg.type === "openKilo") {
      void vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
    }
  }

  private async saveUrls(gateway?: string, platform?: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("kilo-code.new.gatekeeper")
    if (gateway?.trim()) {
      await cfg.update("gatewayUrl", gateway.trim(), vscode.ConfigurationTarget.Workspace)
    }
    if (platform?.trim()) {
      await cfg.update("platformUrl", platform.trim(), vscode.ConfigurationTarget.Workspace)
    }
  }
}

export async function focusLogin(): Promise<void> {
  await vscode.commands.executeCommand("kilo-code.GatekeeperLogin.focus")
}
