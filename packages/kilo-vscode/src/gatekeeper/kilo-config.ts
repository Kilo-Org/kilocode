import * as vscode from "vscode"

const ENT = "kilo-code.new.enterprise"
const SSO = "gatekeeper-sso"

async function write(key: string, value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration()
  await cfg.update(key, value, vscode.ConfigurationTarget.Global)
  if (vscode.workspace.workspaceFolders?.length) {
    await cfg.update(key, value, vscode.ConfigurationTarget.Workspace)
  }
}

/** 登录后直连云端网关（Bearer JWT），不经过本地代理。 */
export async function applyRemoteEngine(gateway: string, enginePath: string): Promise<void> {
  const root = gateway.replace(/\/+$/, "")
  const path = enginePath.startsWith("/") ? enginePath : `/${enginePath}`
  await write(`${ENT}.gatewayUrl`, root)
  await write(`${ENT}.remoteServer.enabled`, true)
  await write(`${ENT}.remoteServer.url`, path)
  await write(`${ENT}.remoteServer.password`, SSO)
}

export async function clearRemoteEngine(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration()
  await cfg.update(`${ENT}.remoteServer.enabled`, false, vscode.ConfigurationTarget.Global)
  await cfg.update(`${ENT}.remoteServer.enabled`, false, vscode.ConfigurationTarget.Workspace)
}
