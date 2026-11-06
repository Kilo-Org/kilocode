import { ConfigurationTarget, workspace, env } from "vscode"

const INTEGRATED_BROWSER = "kilo-code.v2.agentManager.browser"
const BROWSER_AUTOMATION = "kilo-code.v2.browserAutomation"
const INTEGRATED_BROWSER_FLAG = "kilo-code.v2"

/** The Integrated Browser is on by default and can be turned off per application. */
export function integratedBrowserEnabled(): boolean {
  return workspace.getConfiguration(INTEGRATED_BROWSER_FLAG).get<boolean>("integratedBrowser", true) !== false
}

/**
 * Read the Chrome preference for the Agent Manager Integrated Browser.
 *
 * The broker and the settings payload both use this so the toggle in Settings
 * and the effective value stay in sync. The Playwright setting under Web Tools
 * stays independent.
 */
export function integratedBrowserUseSystemChrome(): boolean {
  return workspace.getConfiguration(INTEGRATED_BROWSER).get("useSystemChrome", true)
}

export function integratedBrowserFallback(remote = env.remoteName): boolean {
  return remote === "wsl" && workspace.getConfiguration(INTEGRATED_BROWSER).inspect<boolean>("useSystemChrome")?.globalValue == null
}

/** Keep the settings payload and effective link destination in sync. */
export function integratedBrowserLinkDestination() {
  const value = workspace.getConfiguration(INTEGRATED_BROWSER).get<string>("openLinksIn", "integrated")
  return value === "external" ? "external" : "integrated"
}

/**
 * Copy a user-level Chrome preference that was stored, before this setting had
 * its own key, in the Playwright section.
 *
 * Runs once on activation and only when the current key has no explicit value,
 * so the old Playwright preference is preserved without aliasing the two
 * features afterwards. Workspace-scoped legacy values are left alone because
 * the current key is application-scoped and cannot store them.
 */
export async function migrateIntegratedBrowserUseSystemChrome(): Promise<void> {
  const browser = workspace.getConfiguration(INTEGRATED_BROWSER)
  if (browser.inspect?.<boolean>("useSystemChrome")?.globalValue !== undefined) return
  const value = workspace.getConfiguration(BROWSER_AUTOMATION).inspect?.<boolean>("useSystemChrome")?.globalValue
  if (value === undefined) return
  await browser.update("useSystemChrome", value, ConfigurationTarget.Global)
}