import * as vscode from "vscode"
import { PROXY_PASSWORD } from "./proxy"

const KILO = "kilo-code.new.enterprise"

export async function applyKiloProxy(port: number, enginePath: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration()
  const path = enginePath.startsWith("/") ? enginePath : `/${enginePath}`
  await cfg.update(`${KILO}.gatewayUrl`, `http://127.0.0.1:${port}`, vscode.ConfigurationTarget.Workspace)
  await cfg.update(`${KILO}.remoteServer.enabled`, true, vscode.ConfigurationTarget.Workspace)
  await cfg.update(`${KILO}.remoteServer.url`, path, vscode.ConfigurationTarget.Workspace)
  await cfg.update(`${KILO}.remoteServer.password`, PROXY_PASSWORD, vscode.ConfigurationTarget.Workspace)
}

export async function clearKiloProxy(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration()
  await cfg.update(`${KILO}.remoteServer.enabled`, false, vscode.ConfigurationTarget.Workspace)
}
