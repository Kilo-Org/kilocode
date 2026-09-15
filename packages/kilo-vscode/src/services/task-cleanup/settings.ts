import * as vscode from "vscode"
import { clampDays } from "./classify"

export interface CleanupSettings {
  enabled: boolean
  defaultRetentionDays: number
  incompleteRetentionDays: number
}

export function cleanupSettings(): CleanupSettings {
  const config = vscode.workspace.getConfiguration("kilo-code.new.autoCleanup")
  return {
    enabled: config.get<boolean>("enabled", false),
    defaultRetentionDays: clampDays(config.get("defaultRetentionDays"), 30),
    incompleteRetentionDays: clampDays(config.get("incompleteRetentionDays"), 7),
  }
}

/** Guards updateSetting writes from the webview; mirrors VS Code schema minimums. */
export function validAutoCleanupSetting(leaf: string, value: unknown): boolean {
  if (leaf === "enabled") return typeof value === "boolean"
  if (leaf === "defaultRetentionDays" || leaf === "incompleteRetentionDays") {
    if (value === null || value === undefined) return true
    return typeof value === "number" && Number.isFinite(value) && value >= 1
  }
  return false
}
