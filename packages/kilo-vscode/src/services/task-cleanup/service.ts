import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { DAY_MS, deletionRoots, expiredSessions, type CleanupSession } from "./classify"
import { cleanupSettings } from "./settings"

export interface CleanupResult {
  at: number
  scanned: number
  deleted: number
  skippedActive: number
  failed: number
  durationMs: number
}

const STARTUP_DELAY_MS = 2 * 60_000
const INTERVAL_MS = DAY_MS

/**
 * Deletes expired sessions from the CLI backend on a schedule. Sessions that
 * are currently running (backend session status other than idle) are always
 * protected, as are sessions with a recent fork (see classify.ts).
 */
export class TaskCleanupService {
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private disposed = false

  constructor(
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  start(): void {
    this.disposed = false
    this.schedule(STARTUP_DELAY_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  lastResult(): CleanupResult | null {
    return this.context.globalState.get<CleanupResult>("taskCleanup.lastResult") ?? null
  }

  /**
   * Scheduled entry point — honors the enable flag and a minimum daily
   * spacing (also covers a manual run shortly before a restart). Reschedules
   * itself one interval after each tick completes, so a run can never
   * suppress the following tick.
   */
  private async tick(): Promise<void> {
    try {
      if (this.disposed) return
      if (!cleanupSettings().enabled) return
      const last = this.lastResult()
      if (last && Date.now() - last.at < INTERVAL_MS) return
      await this.run()
    } finally {
      if (!this.disposed) this.schedule(INTERVAL_MS)
    }
  }

  /**
   * Runs a cleanup pass now (also used by the settings "Run Cleanup Now"
   * button). Returns null when a pass is already in flight or the backend is
   * not connected.
   */
  async run(): Promise<CleanupResult | null> {
    if (this.running) return null
    this.running = true
    const started = Date.now()
    try {
      const client = this.connection.getClient()
      const settings = cleanupSettings()
      const list = await client.experimental.session.list({ limit: Number.MAX_SAFE_INTEGER }, { throwOnError: true })

      const sessions: CleanupSession[] = list.data.map((s) => ({
        id: s.id,
        directory: s.directory,
        parentID: s.parentID,
        created: s.time.created,
        updated: s.time.updated,
      }))
      const expired = expiredSessions(sessions, {
        defaultDays: settings.defaultRetentionDays,
        incompleteDays: settings.incompleteRetentionDays,
      })
      // The backend deletes children with their parent, so only expired
      // roots get a delete call; cascaded descendants would just 404.
      const roots = deletionRoots(sessions, expired)

      // Group candidates by directory so each backend instance's status can be
      // checked once; a failed status lookup skips every session in that
      // directory (deletion must fail closed).
      const dirs = new Map<string, CleanupSession[]>()
      for (const s of roots) {
        const list = dirs.get(s.directory) ?? []
        list.push(s)
        dirs.set(s.directory, list)
      }

      let deleted = 0
      let skippedActive = 0
      let failed = 0
      for (const [directory, group] of dirs) {
        let active: Set<string>
        try {
          const status = await client.session.status({ directory }, { throwOnError: true })
          active = new Set(
            Object.entries(status.data ?? {})
              .filter(([, value]) => value.type !== "idle")
              .map(([id]) => id),
          )
        } catch (err) {
          console.warn(`[Kilo New] Task cleanup: status check failed for ${directory}`, err)
          continue
        }
        for (const s of group) {
          if (active.has(s.id)) {
            skippedActive++
            continue
          }
          try {
            await client.session.delete({ sessionID: s.id, directory }, { throwOnError: true })
            deleted++
          } catch (err) {
            failed++
            console.warn(`[Kilo New] Task cleanup: failed to delete session ${s.id}`, err)
          }
        }
      }

      const result: CleanupResult = {
        at: started,
        scanned: sessions.length,
        deleted,
        skippedActive,
        failed,
        durationMs: Date.now() - started,
      }
      await this.context.globalState.update("taskCleanup.lastResult", result)
      console.log(
        `[Kilo New] Task cleanup: deleted ${deleted}/${roots.length} expired roots of ${sessions.length} scanned in ${result.durationMs}ms`,
      )
      return result
    } catch (err) {
      console.warn("[Kilo New] Task cleanup pass failed:", err)
      return null
    } finally {
      this.running = false
    }
  }
}

let shared: TaskCleanupService | undefined

/** One scheduler per extension host, shared by every KiloProvider instance. */
export function taskCleanup(connection: KiloConnectionService, context: vscode.ExtensionContext): TaskCleanupService {
  return (shared ??= new TaskCleanupService(connection, context))
}
