import type { MigrationSessionInfo, MigrationSessionProgress, MigrationSessionSelection } from "./legacy-types"
import type { MigrationResultItem } from "./migration-types"
import { buildSessionMeta, buildSessionProgress } from "./migration-session-progress"
import type { SessionSource } from "./task-store"
import type { migrate as migrateSession } from "./sessions/migrate"

const DELAY = 300
const SUMMARY_DELAY = 1000

type Result = Awaited<ReturnType<typeof migrateSession>>

interface BatchOptions {
  selections: MigrationSessionSelection[]
  sessions: MigrationSessionInfo[]
  resolve(id: string): SessionSource | undefined
  migrate(
    selection: MigrationSessionSelection,
    source: SessionSource,
    progress: ReturnType<typeof buildSessionProgress>,
  ): Promise<Result>
  onProgress(item: string, status: "migrating" | "success" | "warning" | "error", message?: string): void
  onSessionProgress?: (progress: MigrationSessionProgress) => void
  delay?: (ms: number) => Promise<void>
}

export async function runSessionBatch(options: BatchOptions): Promise<MigrationResultItem[]> {
  const results: MigrationResultItem[] = []
  const wait = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  for (const [index, selection] of options.selections.entries()) {
    options.onProgress(selection.id, "migrating")
    const session = options.sessions.find((entry) => entry.id === selection.id)
    const source = options.resolve(selection.id)
    if (!source) {
      const message = "Session source not found"
      results.push({ item: session?.title ?? selection.id, category: "session", status: "error", message })
      options.onProgress(selection.id, "error", message)
      continue
    }

    const meta = buildSessionMeta(session, index, options.selections.length)
    const result = await options.migrate(selection, source, buildSessionProgress(meta, options.onSessionProgress))
    const status = result.ok ? (result.skipped ? "warning" : "success") : "error"
    const message = result.ok ? (result.skipped ? "Already imported." : undefined) : result.message
    results.push({ item: session?.title ?? selection.id, category: "session", status, message })
    options.onProgress(selection.id, status, message)
    if (index < options.selections.length - 1) await wait(DELAY)
  }

  const last = options.selections.at(-1)
  const session = last ? options.sessions.find((entry) => entry.id === last.id) : undefined
  if (session && options.onSessionProgress) {
    options.onSessionProgress({
      session,
      index: options.selections.length,
      total: options.selections.length,
      phase: "summary",
    })
    await wait(SUMMARY_DELAY)
  }

  return results
}
