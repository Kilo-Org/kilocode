import * as vscode from "vscode"

const INTEGRATED_BROWSER = "kilo-code.new.agentManager.browser"
const BROWSER_AUTOMATION = "kilo-code.new.browserAutomation"

/**
 * Resolve the Chrome preference for the Agent Manager Integrated Browser.
 *
 * The setting moved out of the Playwright namespace, so an explicit value on
 * the new key wins and an unset key falls back to the previous location.
 * The broker and the settings payload both use this helper so the toggle in
 * Settings and the effective value stay in sync.
 */
export function integratedBrowserUseSystemChrome(): boolean {
  const browser = vscode.workspace.getConfiguration(INTEGRATED_BROWSER)
  // `inspect` reports whether a value is really set, but some test doubles omit it.
  const chosen = browser.inspect?.<boolean>("useSystemChrome")?.globalValue
  if (chosen !== undefined) return chosen
  return vscode.workspace.getConfiguration(BROWSER_AUTOMATION).get("useSystemChrome", true)
}
