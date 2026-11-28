export * as PermitGuard from "./permit-guard"

import { Duration, Effect, Semaphore } from "effect"
import { LockTimeoutError, SqlError, isSqlError } from "effect/unstable/sql/SqlError"

// kilocode_change start - bounded SQLite permit acquisition (#16497)
//
// All SQLite access in the Bun driver is serialized through a single-permit
// semaphore while every statement runs synchronously on the Bun event loop.
// An unbounded permit wait turns one non-returning writer (file lock, antivirus
// scan, suspended holder fiber) into a permanent, silent freeze of every
// database-backed request, while non-database work (timers, media, CSS) keeps
// running. Bound the wait and surface the same LockTimeout SqlError reason the
// native busy path already produces, so existing `isBusy` retries, the HTTP 503
// "database busy" mapping and prompt error events handle it without a new path.

// Long enough to never fire under ordinary lock contention (native busy_timeout
// is 5s) or large legitimate transactions, short enough to recover a wedged
// database in tens of seconds instead of never.
export const SqlitePermitTimeout: Duration.Duration = Duration.seconds(30)
export const SqlitePermitTimeoutLabel = "30 seconds"

export const permitTimeoutSqlError = (operation: string): SqlError =>
  new SqlError({
    reason: new LockTimeoutError({
      cause: new Error(`Timed out after ${SqlitePermitTimeoutLabel} waiting for the SQLite permit (${operation})`),
      message: "Timed out waiting for the SQLite database",
      operation,
    }),
  })

export const isPermitTimeoutSqlError = (error: unknown): error is SqlError =>
  isSqlError(error) && error.reason._tag === "LockTimeoutError"

/**
 * Acquire `permits` from `semaphore`, failing with a retryable
 * {@link LockTimeoutError} SqlError after `timeout` instead of parking the
 * caller forever. The wait stays interruptible, so on timeout no permit is
 * held and no release is required.
 */
export const takeWithTimeout = (
  semaphore: Semaphore.Semaphore,
  permits: number,
  operation: string,
  timeout: Duration.Input = SqlitePermitTimeout,
): Effect.Effect<number, SqlError> =>
  semaphore.take(permits).pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", () => Effect.fail(permitTimeoutSqlError(operation))),
  )
// kilocode_change end
