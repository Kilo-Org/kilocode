import type { KiloClient } from "@kilocode/sdk/v2/client"
import type {
  MigrationSelections,
  MigrationSessionProgress,
  MigrationSessionSelection,
} from "../../legacy-migration/legacy-types"
import { runSessionBatch } from "../../legacy-migration/session-batch"
import { migrate as migrateSession } from "../../legacy-migration/sessions/migrate"
import { resolveSession } from "../../legacy-migration/task-store"
import { detectRooCodeSessions, type RooImportSource } from "../../roo-import/service"

interface MigrationExtensionContext {
  globalState: {
    get<T>(key: string): T | undefined
    get<T>(key: string, defaultValue: T): T
    update(key: string, value: unknown): PromiseLike<void>
  }
  globalStorageUri: { fsPath: string }
}

export type MigrationSource = "roo"
export type MigrationCacheEntry = { operationId: string; source: "roo"; data: RooImportSource | null }
export type MigrationCache = Map<string, MigrationCacheEntry>

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
}

function postSessionProgress(ctx: MigrationContext, operationId: string, progress: MigrationSessionProgress): void {
  ctx.postMessage({
    type: "migrationSessionProgress",
    source: "roo",
    operationId,
    session: progress.session,
    index: progress.index,
    total: progress.total,
    phase: progress.phase,
    error: progress.error,
  })
}

export async function handleRequestMigrationData(
  ctx: MigrationContext,
  source: MigrationSource,
  operationId: string,
): Promise<void> {
  if (source !== "roo" || !ctx.extensionContext) return
  for (const key of ctx.migrationCache.keys()) {
    if (key !== operationId) ctx.migrationCache.delete(key)
  }
  const roo = await detectRooCodeSessions(ctx.extensionContext as Parameters<typeof detectRooCodeSessions>[0])
  ctx.migrationCache.set(operationId, { operationId, source, data: roo })
  ctx.postMessage({
    type: "migrationData",
    source,
    operationId,
    data: { sessions: roo?.sessions ?? [] },
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
    onSessionProgress: (progress) => postSessionProgress(ctx, operationId, progress),
  })

  ctx.postMessage({ type: "migrationComplete", source: "roo", operationId, results })
}

export async function handleStartMigration(
  ctx: MigrationContext,
  source: MigrationSource,
  operationId: string,
  selections: MigrationSelections,
): Promise<void> {
  if (source !== "roo") return
  try {
    await startRooMigration(ctx, operationId, selections)
  } finally {
    ctx.migrationCache.delete(operationId)
  }
}
