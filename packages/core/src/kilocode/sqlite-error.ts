import { Cause, Option } from "effect"
import { isSqlError } from "effect/unstable/sql/SqlError"

export function isBusy(error: unknown): boolean {
  if (isSqlError(error)) return error.reason._tag === "LockTimeoutError"
  if (typeof error !== "object" || error === null || !("cause" in error) || error.cause === error) return false
  if (!Cause.isCause(error.cause)) return isBusy(error.cause)
  const failure = Cause.findErrorOption(error.cause)
  return Option.isSome(failure) && isBusy(failure.value)
}
