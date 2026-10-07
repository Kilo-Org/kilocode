import * as vscode from "vscode"
import { integratedBrowserLinkDestination } from "./services/browser-automation/chrome-setting"

const BROWSER_AUTOMATION = "kilo-code.new.experimental"

/** Only route web URLs in trusted workspaces with the Integrated Browser selected. */
function shouldOpenLinkInIntegratedBrowser(url: string): boolean {
  if (!vscode.workspace.isTrusted) return false
  if (vscode.workspace.getConfiguration(BROWSER_AUTOMATION).get<boolean>("browserAutomation", false) !== true)
    return false
  if (integratedBrowserLinkDestination() !== "integrated") return false
  try {
    const protocol = new URL(url).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

export async function openBrowserLink(url: string): Promise<void> {
  const uri = vscode.Uri.parse(url)
  if (shouldOpenLinkInIntegratedBrowser(url)) {
    // The built-in command uses the native browser tab when available.
    await vscode.commands.executeCommand("simpleBrowser.api.open", uri)
    return
  }
  await vscode.env.openExternal(uri)
}
