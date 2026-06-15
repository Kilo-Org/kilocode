import * as vscode from "vscode"

const ROOT = "kilo-code.new.enterprise"

export type RemoteServerSettings = {
  enabled: boolean
  url: string
  password: string
}

export type LicenseSettings = {
  enabled: boolean
  serverUrl: string
  key: string
  offlinePath: string
  offlinePublicKey: string
  offlinePublicKeyPath: string
  cacheHours: number
  graceDays: number
}

export type EnterpriseSettings = {
  productName: string
  gatewayUrl: string
  remote: RemoteServerSettings
  license: LicenseSettings
}

function cfg() {
  return vscode.workspace.getConfiguration(ROOT)
}

export function enterpriseSettings(): EnterpriseSettings {
  const c = cfg()
  return {
    productName: c.get<string>("productName", ""),
    gatewayUrl: c.get<string>("gatewayUrl", "").trim(),
    remote: {
      enabled: c.get<boolean>("remoteServer.enabled", false),
      url: c.get<string>("remoteServer.url", "").trim(),
      password: c.get<string>("remoteServer.password", "").trim(),
    },
    license: {
      enabled: c.get<boolean>("license.enabled", false),
      serverUrl: c.get<string>("license.serverUrl", "").trim(),
      key: c.get<string>("license.key", "").trim(),
      offlinePath: c.get<string>("license.offlinePath", "").trim(),
      offlinePublicKey: c.get<string>("license.offlinePublicKey", "").trim(),
      offlinePublicKeyPath: c.get<string>("license.offlinePublicKeyPath", "").trim(),
      cacheHours: c.get<number>("license.cacheHours", 24),
      graceDays: c.get<number>("license.graceDays", 7),
    },
  }
}

export function remotePassword(settings: RemoteServerSettings): string {
  if (settings.password) return settings.password
  return process.env.KILO_REMOTE_SERVER_PASSWORD?.trim() ?? ""
}
