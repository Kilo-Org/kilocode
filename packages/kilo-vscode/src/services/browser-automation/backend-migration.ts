import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"

export const MIGRATION_KEY = "kilo.browserAutomation.backendMigrated"

export type Migration = {
  migrated: () => boolean
  enabled: () => boolean
  config: () => Promise<{ browser?: unknown } | undefined>
  write: () => Promise<void>
  mark: () => Promise<void>
  warn: (message: string, error: unknown) => void
}

/**
 * Users who turned on the old Playwright MCP setting keep browser automation:
 * write browser.backend once, unless they already configured a browser block.
 */
export async function migrateBackend(input: Migration): Promise<"skipped" | "written" | "failed"> {
  if (input.migrated()) return "skipped"
  if (!input.enabled()) {
    await input.mark()
    return "skipped"
  }
  try {
    const config = await input.config()
    if (config?.browser !== undefined) {
      await input.mark()
      return "skipped"
    }
    await input.write()
    await input.mark()
    return "written"
  } catch (error) {
    input.warn("Browser automation setting migration failed", error)
    return "failed"
  }
}

/** Runs once per machine after the CLI connects; the CLI owns browser configuration. */
export async function migrateBrowserBackend(connection: KiloConnectionService, context: vscode.ExtensionContext) {
  const outcome = await migrateBackend({
    migrated: () => context.globalState.get<boolean>(MIGRATION_KEY) === true,
    enabled: () => vscode.workspace.getConfiguration("kilo-code.new.browserAutomation").get<boolean>("enabled", false),
    config: async () => {
      const client = connection.getClient()
      const { data } = await client.global.config.get({ throwOnError: true })
      return data ?? undefined
    },
    write: async () => {
      const client = connection.getClient()
      await client.global.config.update({ config: { browser: { backend: "playwright" } } }, { throwOnError: true })
    },
    mark: async () => {
      await context.globalState.update(MIGRATION_KEY, true)
    },
    warn: (message, error) => console.warn(`[Kilo New] ${message}:`, error),
  })
  if (outcome === "written") console.info("[Kilo New] Migrated browser automation setting to browser.backend")
}
