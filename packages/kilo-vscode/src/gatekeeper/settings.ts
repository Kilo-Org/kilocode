import * as vscode from "vscode"

const ROOT = "kilo-code.new.gatekeeper"

export type GatekeeperSettings = {
  enabled: boolean
  gateway: string
  platform: string
  enginePath: string
  autoRemote: boolean
}

export function gatekeeperSettings(): GatekeeperSettings {
  const c = vscode.workspace.getConfiguration(ROOT)
  const gateway = c.get<string>("gatewayUrl", "").trim()
  const platform = c.get<string>("platformUrl", "").trim() || gateway
  const enginePath = c.get<string>("enginePath", "/kilo").trim() || "/kilo"
  const enabled = c.get<boolean>("enabled", false) || Boolean(gateway)
  return {
    enabled,
    gateway,
    platform: platform.replace(/\/+$/, ""),
    enginePath: enginePath.startsWith("/") ? enginePath : `/${enginePath}`,
    autoRemote: c.get<boolean>("autoConfigureRemote", true),
  }
}

export function engineUrl(settings = gatekeeperSettings()): string {
  const gateway = settings.gateway.replace(/\/+$/, "")
  if (!gateway) return ""
  return `${gateway}${settings.enginePath}`.replace(/\/+$/, "")
}
