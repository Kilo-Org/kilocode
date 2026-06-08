import * as vscode from "vscode"
import type { PermissionRuleset } from "@kilocode/sdk/v2/client"

const SETTING = "agentManager.enableTool"

export function toolPermission(enabled?: boolean): PermissionRuleset | undefined {
  if (enabled !== false) return undefined
  return [{ permission: "agent_manager", action: "deny", pattern: "*" }]
}

export function sessionPermission(): PermissionRuleset | undefined {
  const enabled = vscode.workspace.getConfiguration("kilo-code.new").get<boolean>(SETTING, true)
  return toolPermission(enabled)
}
