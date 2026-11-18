import { ConfigurationTarget, workspace } from "vscode"

/**
 * One-time migration of `kilo-code.v2.browserAutomation.*` into the Kilo config `browser` keys. The old settings
 * controlled a Playwright MCP server the extension started itself; the CLI now serves the browser tools, so the same
 * choices become `browser.backend` and `browser.headless`. `useSystemChrome` has no v2 key: the bundled backend prefers
 * a system Chrome or Edge and only falls back to the Chromium the CLI installs.
 */
export namespace BrowserSettingsMigration {
  export const legacy = "kilo-code.v2.browserAutomation"
  /** Global state marker, so a migrated user is never migrated twice. */
  export const marker = "kilo.browserAutomationMigrated"

  /** The legacy settings as the old extension read them, from the user's own level first. */
  export function read(): { enabled?: boolean; headless?: boolean } {
    const config = workspace.getConfiguration(legacy)
    const value = <T>(key: string) => {
      const inspected = config.inspect?.(key) as { globalValue?: T; workspaceValue?: T } | undefined
      const found = inspected?.globalValue ?? inspected?.workspaceValue
      return found === undefined ? undefined : found
    }
    return { enabled: value<boolean>("enabled"), headless: value<boolean>("headless") }
  }

  /**
   * The `browser` block the legacy values become. "enabled: false" was the old default, not a decision about the new
   * tools, so it leaves the new default alone.
   */
  export function translate(legacyValues: {
    enabled?: boolean
    headless?: boolean
  }): { backend?: "playwright"; headless?: boolean } | undefined {
    const browser: { backend?: "playwright"; headless?: boolean } = {}
    if (legacyValues.enabled === true) browser.backend = "playwright"
    if (legacyValues.headless !== undefined) browser.headless = legacyValues.headless
    return Object.keys(browser).length ? browser : undefined
  }

  export type Input = {
    /** Fill the Kilo config keys at the global scope, and answer with the keys it actually wrote. */
    write: (browser: { backend?: "playwright"; headless?: boolean }) => Promise<string[]>
    state: { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> }
    log?: (...args: unknown[]) => void
  }

  export type Result = { migrated: boolean; wrote: string[]; error?: string }

  /**
   * The `browser` keys of `wanted` the document does not already set. A key the user set — to any value — is theirs,
   * and a `null` counts as unset because the settings RPC removes a key by writing null.
   */
  export function fill(
    document: unknown,
    wanted: { backend?: "playwright"; headless?: boolean },
  ): { backend?: "playwright"; headless?: boolean } {
    let browser: Record<string, unknown> = {}
    if (typeof document === "object" && document !== null && "browser" in document) {
      const block = document.browser
      // The parsed document is JSON: an object here is the `browser` block, any other value is not a setting.
      if (typeof block === "object" && block !== null) browser = block as Record<string, unknown>
    }
    const filled: { backend?: "playwright"; headless?: boolean } = {}
    if (wanted.backend !== undefined && browser.backend == null) filled.backend = wanted.backend
    if (wanted.headless !== undefined && browser.headless == null) filled.headless = wanted.headless
    return filled
  }

  /**
   * Migrate once, then clear the legacy keys so nothing reads them again. A failure leaves both the marker and the
   * settings alone, so the next activation retries instead of losing the user's choice.
   */
  export async function run(input: Input): Promise<Result> {
    if (input.state.get<boolean>(marker) === true) return { migrated: false, wrote: [] }
    const legacyValues = read()
    if (legacyValues.enabled === undefined && legacyValues.headless === undefined) return { migrated: false, wrote: [] }
    const set = translate(legacyValues)
    if (!set) {
      await input.state.update(marker, true)
      return { migrated: false, wrote: [] }
    }
    let wrote: string[]
    try {
      wrote = await input.write(set)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      input.log?.("browser settings migration failed", message)
      return { migrated: false, wrote: [], error: message }
    }
    const config = workspace.getConfiguration(legacy)
    for (const key of ["enabled", "headless", "useSystemChrome"])
      await config.update(key, undefined, ConfigurationTarget.Global).then(
        () => undefined,
        () => undefined,
      )
    await input.state.update(marker, true)
    return { migrated: true, wrote }
  }
}
