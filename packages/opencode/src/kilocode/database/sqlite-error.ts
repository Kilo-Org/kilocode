import { isSqlError } from "effect/unstable/sql/SqlError"

export const busyMessage = "Database is busy. Please try again in a moment."

export function isBusy(error: unknown) {
  return isSqlError(error) && error.reason._tag === "LockTimeoutError"
}
