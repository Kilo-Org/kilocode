/**
 * Legacy migration handlers — extracted from KiloProvider.
 *
 * Manages the migration wizard for users upgrading from Kilo Code v5.x.
 * No vscode dependency — all vscode access is injected via MigrationContext.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { LegacyMigrationData, MigrationSelections } from "../../legacy-migration/legacy-types"
import * as MigrationService from "../../legacy-migration/migration-service"

/** Subset of vscode.ExtensionContext needed by migration handlers. */
interface MigrationExtensionContext {
  globalState: {
    get<T>(key: string): T | undefined
    get<T>(key: string, defaultValue: T): T
    update(key: string, value: unknown): PromiseLike<void>
  }
  secrets: {
    get(key: string): PromiseLike<string | undefined>
    store(key: string, value: string): PromiseLike<void>
    delete(key: string): PromiseLike<void>
  }
  globalStorageUri: { fsPath: string }
}

export interface MigrationContext {
  readonly client: KiloClient | null
  readonly extensionContext: MigrationExtensionContext | undefined
  postMessage(msg: unknown): void
  cachedLegacyData: LegacyMigrationData | null
  migrationCheckInFlight: boolean
  disposeGlobal(): Promise<void>
}

/**
 * Check for legacy data on first run and auto-navigate to the migration wizard
 * if the user has not yet been prompted.
 */
export async function checkAndShowMigrationWizard(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  if (ctx.migrationCheckInFlight) return
  // MigrationService.getMigrationStatus accepts the full ExtensionContext shape
  const status = MigrationService.getMigrationStatus(
    ctx.extensionContext as Parameters<typeof MigrationService.getMigrationStatus>[0],
  )
  if (status) return // already prompted (skipped or completed)

  ctx.migrationCheckInFlight = true
  const data = await MigrationService.detectLegacyData(
    ctx.extensionContext as Parameters<typeof MigrationService.detectLegacyData>[0],
  )
  ctx.migrationCheckInFlight = false

  if (!data.hasData) return

  // Cache so migrate() doesn't re-read from SecretStorage/disk
  ctx.cachedLegacyData = data

  console.log("[Kilo New] KiloProvider: 🔄 Legacy data detected, showing migration wizard")
  ctx.postMessage({ type: "navigate", view: "migration" })
  ctx.postMessage({
    type: "legacyMigrationData",
    data: {
      providers: data.providers,
      mcpServers: data.mcpServers,
      customModes: data.customModes,
      defaultModel: data.defaultModel,
      settings: data.settings,
    },
  })
}

/** Send the detected legacy data to the webview on explicit request. */
export async function handleRequestLegacyMigrationData(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  const data = await MigrationService.detectLegacyData(
    ctx.extensionContext as Parameters<typeof MigrationService.detectLegacyData>[0],
  )
  ctx.cachedLegacyData = data
  ctx.postMessage({
    type: "legacyMigrationData",
    data: {
      providers: data.providers,
      mcpServers: data.mcpServers,
      customModes: data.customModes,
      defaultModel: data.defaultModel,
      settings: data.settings,
    },
  })
}

/** Run the migration for the selected items. */
export async function handleStartLegacyMigration(
  ctx: MigrationContext,
  selections: MigrationSelections,
): Promise<void> {
  if (!ctx.extensionContext || !ctx.client) return
  try {
    const results = await MigrationService.migrate(
      ctx.extensionContext as Parameters<typeof MigrationService.migrate>[0],
      ctx.client,
      selections,
      (item, status, message) => {
        ctx.postMessage({ type: "legacyMigrationProgress", item, status, message })
      },
      ctx.cachedLegacyData?.settings,
    )

    // Dispose all instances after migration
    // Reloading the data will be handled once the server replies with a global.disposed event
    await ctx.disposeGlobal()

    // Only mark as completed if at least one item succeeded — if everything failed
    // the user can still re-run migration via Settings → About.
    const success = results.some((r) => r.status === "success")

    if (success) {
      await MigrationService.setMigrationStatus(
        ctx.extensionContext as Parameters<typeof MigrationService.setMigrationStatus>[0],
        "completed",
      )
    }

    ctx.postMessage({ type: "legacyMigrationComplete", results })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: ❌ Migration failed", error)
    ctx.postMessage({
      type: "legacyMigrationComplete",
      results: [
        {
          item: "Migration",
          category: "settings",
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    })
  }
}

/** Record that the user skipped migration. */
export async function handleSkipLegacyMigration(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  await MigrationService.setMigrationStatus(
    ctx.extensionContext as Parameters<typeof MigrationService.setMigrationStatus>[0],
    "skipped",
  )
}

/** Clear legacy data from SecretStorage and globalState after user opts in. */
export async function handleClearLegacyData(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  await MigrationService.clearLegacyData(ctx.extensionContext as Parameters<typeof MigrationService.clearLegacyData>[0])
}
