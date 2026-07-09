import type * as vscode from "vscode"
import { getToken } from "./auth"
import { gatekeeperSettings } from "./settings"

export function gatekeeperDirectRemote(): boolean {
  const gk = gatekeeperSettings()
  return gk.enabled && Boolean(gk.gateway)
}

export async function gatekeeperAuthTag(context: vscode.ExtensionContext): Promise<string> {
  if (!gatekeeperSettings().enabled) return ""
  const token = await getToken(context)
  if (!token) return ""
  return token.slice(-12)
}

export async function remoteAuthHeader(context: vscode.ExtensionContext, password: string): Promise<string> {
  if (gatekeeperSettings().enabled) {
    const token = await getToken(context)
    if (token) return `Bearer ${token}`
  }
  return `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}`
}
