/**
 * Legacy migration handlers — extracted from KiloProvider.
 *
 * Manages the migration wizard for users upgrading from Kilo Code v5.x.
 * VS Code access is limited to migration service helpers and injected context.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import type {
  LegacyMigrationData,
  MigrationSelections,
  MigrationSessionProgress,
  MigrationSessionSelection,
} from "../../legacy-migration/legacy-types"
import * as MigrationService from "../../legacy-migration/migration-service"
import { runSessionBatch } from "../../legacy-migration/session-batch"
import { migrate as migrateSession } from "../../legacy-migration/sessions/migrate"
import { resolveSession } from "../../legacy-migration/task-store"
import { detectRooCodeSessions, type RooImportSource } from "../../roo-import/service"

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

export type MigrationSource = "legacy" | "roo"
export type MigrationCacheEntry =
  | { operationId: string; source: "legacy"; data: LegacyMigrationData }
  | { operationId: string; source: "roo"; data: RooImportSource | null }
export type MigrationCache = Map<string, MigrationCacheEntry>

export function getMigrationCache(
  cache: MigrationCache,
  source: "legacy",
  operationId: string,
): Extract<MigrationCacheEntry, { source: "legacy" }> | undefined
export function getMigrationCache(
  cache: MigrationCache,
  source: "roo",
  operationId: string,
): Extract<MigrationCacheEntry, { source: "roo" }> | undefined
export function getMigrationCache(cache: MigrationCache, source: MigrationSource, operationId: string) {
  const entry = cache.get(operationId)
  return entry?.source === source ? entry : undefined
}

export interface MigrationContext {
  readonly client: KiloClient | null
  readonly extensionContext: MigrationExtensionContext | undefined
  postMessage(msg: unknown): void
  refreshSessions(): void
  migrationCache: MigrationCache
  migrationCheckInFlight: boolean
  lastMigrationHadErrors?: boolean
  disposeGlobal(): Promise<void>
  broadcastComplete(): void
}

function emptyData(sessions: LegacyMigrationData["sessions"] = []): LegacyMigrationData {
  return {
    hasData: sessions.length > 0,
    providers: [],
    mcpServers: [],
    customModes: [],
    sessions,
  }
}

function postSessionProgress(
  ctx: MigrationContext,
  source: MigrationSource,
  operationId: string,
  progress: MigrationSessionProgress,
): void {
  ctx.postMessage({
    type: "migrationSessionProgress",
    source,
    operationId,
    session: progress.session,
    index: progress.index,
    total: progress.total,
    phase: progress.phase,
    error: progress.error,
  })
}

/**
 * Check for legacy data on first run and send migration state to the webview
 * if the user has not yet been prompted.
 *
 * Uses a state-based approach (migrationState message) instead of navigate
 * to avoid race conditions with SettingsEditorProvider's view navigation.
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

  console.log("[Kilo New] KiloProvider: 🔄 Legacy data detected, showing migration wizard")
  // The wizard re-requests the data via requestMigrationData on mount, so only the flag is sent here.
  ctx.postMessage({
    type: "migrationState",
    needed: true,
    source: "legacy",
  })
}

/** Send migration data for the requested source to the webview. */
export async function handleRequestMigrationData(
  ctx: MigrationContext,
  source: MigrationSource,
  operationId: string,
): Promise<void> {
  if (!ctx.extensionContext) return
  // A new request means a new wizard session; drop any entry from an abandoned one.
  for (const key of ctx.migrationCache.keys()) {
    if (key !== operationId) ctx.migrationCache.delete(key)
  }
  const data = await (async () => {
    if (source === "roo") {
      const roo = await detectRooCodeSessions(ctx.extensionContext as Parameters<typeof detectRooCodeSessions>[0])
      ctx.migrationCache.set(operationId, { operationId, source, data: roo })
      return emptyData(roo?.sessions ?? [])
    }
    const legacy = await MigrationService.detectLegacyData(
      ctx.extensionContext as Parameters<typeof MigrationService.detectLegacyData>[0],
    )
    ctx.migrationCache.set(operationId, { operationId, source, data: legacy })
    return legacy
  })()
  ctx.postMessage({
    type: "migrationData",
    source,
    operationId,
    data: {
      providers: data.providers,
      mcpServers: data.mcpServers,
      customModes: data.customModes,
      sessions: data.sessions,
      defaultModel: data.defaultModel,
      settings: data.settings,
    },
  })
}

async function startRooMigration(
  ctx: MigrationContext,
  operationId: string,
  selections: { sessions?: MigrationSessionSelection[] },
): Promise<void> {
  if (!ctx.extensionContext || !ctx.client) return
  const cached = getMigrationCache(ctx.migrationCache, "roo", operationId)
  const source = cached
    ? cached.data
    : await detectRooCodeSessions(ctx.extensionContext as Parameters<typeof detectRooCodeSessions>[0])
  if (!cached) ctx.migrationCache.set(operationId, { operationId, source: "roo", data: source })
  if (!source) {
    ctx.postMessage({
      type: "migrationComplete",
      source: "roo",
      operationId,
      results: [
        { item: "Roo Code sessions", category: "session", status: "warning", message: "No Roo Code sessions found." },
      ],
    })
    return
  }

  const results = await runSessionBatch({
    selections: selections.sessions ?? [],
    sessions: source.sessions,
    resolve: (id) => resolveSession(source.catalog, id),
    migrate: (selection, resolved, progress) =>
      migrateSession(
        selection,
        ctx.extensionContext as Parameters<typeof migrateSession>[1],
        ctx.client as KiloClient,
        progress,
        resolved,
      ),
    onProgress: (item, status, message) => {
      ctx.postMessage({ type: "migrationProgress", source: "roo", operationId, item, status, message })
    },
    onSessionProgress: (progress) => postSessionProgress(ctx, "roo", operationId, progress),
  })

  ctx.lastMigrationHadErrors = results.some((item) => item.status === "error")
  ctx.postMessage({ type: "migrationComplete", source: "roo", operationId, results })
}

/** Run the migration for the selected items. */
async function startLegacyMigration(
  ctx: MigrationContext,
  operationId: string,
  selections: MigrationSelections,
): Promise<void> {
  if (!ctx.extensionContext || !ctx.client) return
  try {
    const cached = getMigrationCache(ctx.migrationCache, "legacy", operationId)
    const results = await MigrationService.migrate(
      ctx.extensionContext as Parameters<typeof MigrationService.migrate>[0],
      ctx.client,
      selections,
      (item, status, message) => {
        ctx.postMessage({ type: "migrationProgress", source: "legacy", operationId, item, status, message })
      },
      (progress: MigrationSessionProgress) => {
        postSessionProgress(ctx, "legacy", operationId, progress)
      },
      cached?.data.settings,
      cached?.data.sessions,
    )

    ctx.lastMigrationHadErrors = results.some((item) => item.status === "error")
    ctx.postMessage({ type: "migrationComplete", source: "legacy", operationId, results })
  } catch (error) {
    ctx.lastMigrationHadErrors = true
    console.error("[Kilo New] KiloProvider: ❌ Migration failed", error)
    ctx.postMessage({
      type: "migrationComplete",
      source: "legacy",
      operationId,
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

export async function handleStartMigration(
  ctx: MigrationContext,
  source: MigrationSource,
  operationId: string,
  selections: MigrationSelections,
): Promise<void> {
  try {
    if (source === "roo") {
      await startRooMigration(ctx, operationId, selections)
      return
    }
    await startLegacyMigration(ctx, operationId, selections)
  } finally {
    // The operation has finished (or thrown); its cached discovery is no longer needed.
    ctx.migrationCache.delete(operationId)
  }
}

export async function handleFinalizeLegacyMigration(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  await ctx.disposeGlobal()
  await MigrationService.setMigrationStatus(
    ctx.extensionContext as Parameters<typeof MigrationService.setMigrationStatus>[0],
    ctx.lastMigrationHadErrors ? "completed_with_errors" : "completed",
  )
  ctx.broadcastComplete()
  ctx.refreshSessions()
}

/** Record that the user skipped migration and broadcast to all instances. */
export async function handleSkipLegacyMigration(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  await MigrationService.setMigrationStatus(
    ctx.extensionContext as Parameters<typeof MigrationService.setMigrationStatus>[0],
    "skipped",
  )
  ctx.broadcastComplete()
}

/** Clear legacy data from SecretStorage and globalState after user opts in. */
export async function handleClearLegacyData(ctx: MigrationContext): Promise<void> {
  if (!ctx.extensionContext) return
  await MigrationService.clearLegacyData(ctx.extensionContext as Parameters<typeof MigrationService.clearLegacyData>[0])
}
