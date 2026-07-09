import * as vscode from "vscode"

const ROOT = "yoyo-auth"

export type AuthSettings = {
  gateway: string
  platform: string
  enginePath: string
  proxyPort: number
  autoKilo: boolean
}

export function authSettings(): AuthSettings {
  const c = vscode.workspace.getConfiguration(ROOT)
  const gateway = c.get<string>("gatewayUrl", "").trim()
  const platform = c.get<string>("platformUrl", "").trim() || gateway
  const enginePath = c.get<string>("enginePath", "/kilo").trim() || "/kilo"
  return {
    gateway,
    platform: platform.replace(/\/+$/, ""),
    enginePath: enginePath.startsWith("/") ? enginePath : `/${enginePath}`,
    proxyPort: c.get<number>("proxyPort", 0),
    autoKilo: c.get<boolean>("autoConfigureKilo", true),
  }
}

export function engineUrl(settings = authSettings()): string {
  const gateway = settings.gateway.replace(/\/+$/, "")
  if (!gateway) return ""
  return `${gateway}${settings.enginePath}`.replace(/\/+$/, "")
}
