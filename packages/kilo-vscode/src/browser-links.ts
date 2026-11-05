import * as vscode from "vscode"
import { parse } from "./services/browser-automation/browser-policy"
import {
  integratedBrowserEnabled,
  integratedBrowserLinkDestination,
} from "./services/browser-automation/chrome-setting"

/** True when the browser can open the URL: public HTTPS or loopback HTTP. */
function browsable(url: string): boolean {
  try {
    parse(url)
    return true
  } catch {
    return false
  }
}

/**
 * In-app routing needs a trusted workspace, the Integrated Browser flag, the
 * "integrated" destination, and a URL the browser accepts. Everything else
 * stays external, so a link such as plain HTTP to a LAN host is never
 * swallowed by a browser that refuses it.
 */
export function shouldOpenLinkInIntegratedBrowser(url: string): boolean {
  if (!vscode.workspace.isTrusted) return false
  if (!integratedBrowserEnabled()) return false
  if (integratedBrowserLinkDestination() !== "integrated") return false
  return browsable(url)
}

/**
 * Open a web link in the Kilo Integrated Browser through the provided opener,
 * and fall back to the system browser when integration is unavailable or the
 * opener cannot take the link. A navigation error inside the browser does not
 * reject the opener, so this never opens both.
 */
export async function openBrowserLink(url: string, openIntegrated?: () => boolean): Promise<void> {
  const uri = vscode.Uri.parse(url)
  if (shouldOpenLinkInIntegratedBrowser(url) && openerAccepted(openIntegrated)) return
  await vscode.env.openExternal(uri)
}

function openerAccepted(openIntegrated?: () => boolean): boolean {
  if (!openIntegrated) return false
  try {
    return openIntegrated()
  } catch (error) {
    console.warn("[Kilo New] Integrated Browser open failed, opening externally:", error)
    return false
  }
}
