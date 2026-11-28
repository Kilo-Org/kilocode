import { Database } from "@opencode-ai/core/database/database"
import { Duration, Effect, Exit } from "effect"

export * as DeepHealth from "./deep-health"

const DEEP_HEALTH_TIMEOUT: Duration.Input = "5 seconds"

/**
 * Run `SELECT 1` through the production single-permit SQLite driver (#16497).
 *
 * The shallow `/global/health` endpoint never touches SQLite, so it cannot tell a wedged database
 * from a healthy one. This probe shares the same semaphore + native driver as every real query, so
 * it times out or fails precisely when database-backed IPC is blocked. The bounded timeout keeps
 * the probe itself from hanging the HTTP layer.
 *
 * The 5s probe timeout is deliberately shorter than the 30s bounded permit wait
 * (`PermitGuard.SqlitePermitTimeout`): a wedged driver would otherwise make the host poll up to 30s
 * per round before learning the backend is unhealthy, slowing watchdog recovery. On timeout the
 * probe simply reports unhealthy; the guarded statement still fails safely on its own 30s boundary.
 *
 * Returns `false` for any failure (timeout, lock, native error) rather than failing the effect, so
 * callers can translate it into an explicit unhealthy response. `timeout` stays injectable so tests
 * exercise the timeout branch without waiting the full production budget.
 */
export const probe = (timeout: Duration.Input = DEEP_HEALTH_TIMEOUT): Effect.Effect<boolean, never, Database.Service> =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const result = yield* database.db.run("SELECT 1").pipe(Effect.timeout(timeout), Effect.exit)
    return Exit.isSuccess(result)
  })
