import * as vscode from "vscode"
import { enterpriseSettings } from "./settings"

export function extensionDisplayName(): string {
  try {
    const custom = enterpriseSettings().productName.trim()
    if (custom) return custom
  } catch {
    // vscode API unavailable outside extension host
  }
  return "Kilo Code"
}
