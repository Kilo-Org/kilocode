import * as vscode from "vscode"
import { authSession, clearToken, getToken, handleCallback } from "./auth"
import { applyRemoteEngine, clearRemoteEngine } from "./kilo-config"
import { refreshEnterpriseUsage } from "../enterprise/usage"
import { LoginProvider, focusLogin } from "./LoginProvider"
import { engineUrl, gatekeeperSettings } from "./settings"

const CTX = "kilo-code.gatekeeper.needsLogin"

let loginProvider: LoginProvider | null = null
let ready: Promise<void> = Promise.resolve()

export function whenGatekeeperReady(): Promise<void> {
  return ready
}

async function setNeedsLogin(needs: boolean): Promise<void> {
  await vscode.commands.executeCommand("setContext", CTX, needs)
}

async function startSession(context: vscode.ExtensionContext): Promise<void> {
  const cfg = gatekeeperSettings()
  const gateway = cfg.gateway
  const token = (await getToken(context)) ?? ""
  if (!gateway) throw new Error("请配置 kilo-code.new.gatekeeper.gatewayUrl")
  if (!token) throw new Error("未登录")
  if (cfg.autoRemote) {
    await applyRemoteEngine(gateway, cfg.enginePath)
  }
}

async function afterLogin(context: vscode.ExtensionContext): Promise<void> {
  await startSession(context)
  await setNeedsLogin(false)
  loginProvider?.refresh()
  const url = engineUrl()
  void vscode.window.showInformationMessage(`SSO 登录成功，已连接 ${url}`)
  await vscode.commands.executeCommand("workbench.action.reloadWindow")
}

async function logout(context: vscode.ExtensionContext): Promise<void> {
  await clearToken(context)
  await clearRemoteEngine()
  await setNeedsLogin(true)
  loginProvider?.refresh()
  await focusLogin()
}

export function registerGatekeeper(context: vscode.ExtensionContext): void {
  const cfg = gatekeeperSettings()
  if (!cfg.enabled) {
    ready = Promise.resolve()
    void setNeedsLogin(false)
    return
  }

  const host = {
    context,
    engineUrl: () => engineUrl(),
    onLogout: () => logout(context),
  }

  loginProvider = new LoginProvider(host)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("kilo-code.GatekeeperLogin", loginProvider),
    vscode.commands.registerCommand("kilo-code.new.gatekeeper.login", async () => {
      await focusLogin()
      const { login: start } = await import("./auth")
      await start(context)
    }),
    vscode.commands.registerCommand("kilo-code.new.gatekeeper.logout", () => logout(context)),
  )

  ready = bootstrap(context)
}

async function bootstrap(context: vscode.ExtensionContext): Promise<void> {
  const s = await authSession(context)
  if (s.loggedIn && s.gateway) {
    try {
      await startSession(context)
      await refreshEnterpriseUsage(context)
      await setNeedsLogin(false)
      return
    } catch (err) {
      console.error("[gatekeeper] session restore failed:", err)
      await setNeedsLogin(true)
      await focusLogin()
      return
    }
  }
  await setNeedsLogin(true)
  await focusLogin()
}

export async function handleGatekeeperUri(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<boolean> {
  if (!gatekeeperSettings().enabled) return false
  if (!(await handleCallback(context, uri))) return false
  await afterLogin(context)
  return true
}

export async function disposeGatekeeper(): Promise<void> {}
