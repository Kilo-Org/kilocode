import * as vscode from "vscode"

const INTEGRATED_BROWSER = "kilo-code.new.agentManager.browser"
const BROWSER_AUTOMATION = "kilo-code.new.browserAutomation"

/**
 * Read the Chrome preference for the Agent Manager Integrated Browser.
 *
 * The broker and the settings payload both use this so the toggle in Settings
 * and the effective value stay in sync. The Playwright setting under Web Tools
 * stays independent.
 */
export function integratedBrowserUseSystemChrome(): boolean {
  return vscode.workspace.getConfiguration(INTEGRATED_BROWSER).get("useSystemChrome", true)
}

export function integratedBrowserUserDataDir(): string | undefined {
  const value = vscode.workspace.getConfiguration(INTEGRATED_BROWSER).get<string>("userDataDir", "")
  return value || undefined
}

/**
 * Copy a user-level Chrome preference that was stored before this setting had
 * its own key.
 *
 * Runs once on activation and only when the current key has no explicit value,
 * so the old Playwright preference is preserved without aliasing the two
 * features afterwards. Workspace-scoped legacy values are left alone because
 * the current key is application-scoped and cannot store them.
 */
export async function migrateIntegratedBrowserUseSystemChrome(): Promise<void> {
  const browser = vscode.workspace.getConfiguration(INTEGRATED_BROWSER)
  if (browser.inspect?.<boolean>("useSystemChrome")?.globalValue !== undefined) return
  const value = vscode.workspace.getConfiguration(BROWSER_AUTOMATION).inspect?.<boolean>("useSystemChrome")?.globalValue
  if (value === undefined) return
  await browser.update("useSystemChrome", value, vscode.ConfigurationTarget.Global)
}
