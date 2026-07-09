import * as vscode from "vscode"
import { gatekeeperSettings } from "./settings"

const SECRET = "kilo.gatekeeper.token"

export function callbackUri(context: vscode.ExtensionContext): string {
  const pub = context.extension.packageJSON.publisher as string
  const name = context.extension.packageJSON.name as string
  return `vscode://${pub}.${name}/gatekeeper/callback`
}

export async function getToken(context: vscode.ExtensionContext): Promise<string | null> {
  return (await context.secrets.get(SECRET)) ?? null
}

export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET)
}

async function storeToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store(SECRET, token)
}

export async function login(context: vscode.ExtensionContext): Promise<void> {
  const base = gatekeeperSettings().platform
  if (!base) {
    throw new Error("请配置 kilo-code.new.gatekeeper.gatewayUrl")
  }
  const url = `${base}/api/v1/auth/login?client=vscode`
  const ok = await vscode.env.openExternal(vscode.Uri.parse(url))
  if (!ok) {
    throw new Error("无法打开浏览器进行 SSO 登录")
  }
}

export async function handleCallback(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<boolean> {
  if (!uri.path.endsWith("/gatekeeper/callback")) return false
  const token = new URLSearchParams(uri.query).get("token")?.trim()
  if (!token) return false
  await storeToken(context, token)
  return true
}

async function fetchUser(token: string, base: string) {
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { id?: string; roles?: string[] }
  if (!data.id) return null
  return { id: data.id, roles: data.roles ?? [] }
}

export async function authSession(context: vscode.ExtensionContext) {
  const cfg = gatekeeperSettings()
  const token = await getToken(context)
  const user = token && cfg.platform ? await fetchUser(token, cfg.platform) : null
  return {
    loggedIn: Boolean(token && user),
    token: token ?? "",
    userId: user?.id ?? "",
    gateway: cfg.gateway,
    platform: cfg.platform,
    enginePath: cfg.enginePath,
  }
}
