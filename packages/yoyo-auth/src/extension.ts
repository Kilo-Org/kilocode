import * as vscode from "vscode"
import { clearToken, handleCallback, session, getToken } from "./auth"
import { applyKiloProxy, clearKiloProxy } from "./kilo-config"
import { LoginProvider, focusLogin, openKiloSidebar } from "./LoginProvider"
import { startProxy, type ProxyHandle } from "./proxy"
import { authSettings, engineUrl } from "./settings"

let proxy: ProxyHandle | null = null
let loginProvider: LoginProvider | null = null

async function stopProxy(): Promise<void> {
  if (!proxy) return
  await proxy.close()
  proxy = null
}

async function startSessionProxy(context: vscode.ExtensionContext): Promise<number> {
  await stopProxy()
  const cfg = authSettings()
  const upstream = engineUrl(cfg)
  const token = (await getToken(context)) ?? ""
  if (!upstream) {
    throw new Error("请配置 yoyo-auth.gatewayUrl")
  }
  if (!token) {
    throw new Error("未登录")
  }
  proxy = await startProxy({ upstream, token, port: cfg.proxyPort || undefined })
  if (cfg.autoKilo) {
    await applyKiloProxy(proxy.port, cfg.enginePath)
  }
  return proxy.port
}

async function afterLogin(context: vscode.ExtensionContext): Promise<void> {
  const port = await startSessionProxy(context)
  loginProvider?.refresh()
  void vscode.window.showInformationMessage(`驭码 SSO 登录成功，本地代理 127.0.0.1:${port}`)
  await vscode.commands.executeCommand("workbench.action.reloadWindow")
}

async function logout(context: vscode.ExtensionContext): Promise<void> {
  await stopProxy()
  await clearToken(context)
  await clearKiloProxy()
  loginProvider?.refresh()
  await focusLogin()
}

export function activate(context: vscode.ExtensionContext): void {
  const host = {
    context,
    proxyPort: () => proxy?.port ?? 0,
    onLogin: () => afterLogin(context),
    onLogout: () => logout(context),
    onOpenKilo: () => openKiloSidebar(),
  }

  loginProvider = new LoginProvider(host)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("yoyo-auth.login", loginProvider),
    vscode.commands.registerCommand("yoyo-auth.login", async () => {
      await focusLogin()
      const { login: start } = await import("./auth")
      await start(context)
    }),
    vscode.commands.registerCommand("yoyo-auth.logout", () => logout(context)),
    vscode.commands.registerCommand("yoyo-auth.openKilo", () => openKiloSidebar()),
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (!(await handleCallback(context, uri))) return
        await afterLogin(context)
      },
    }),
  )

  void (async () => {
    const s = await session(context)
    if (s.loggedIn && s.gateway) {
      try {
        await startSessionProxy(context)
      } catch (err) {
        console.error("[yoyo-auth] proxy restore failed:", err)
        await focusLogin()
      }
      return
    }
    await focusLogin()
  })()
}

export async function deactivate(): Promise<void> {
  await stopProxy()
}
