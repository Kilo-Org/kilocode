import { Cause, Data } from "effect"

export class UserError extends Data.TaggedError("UserError")<{ readonly message: string }> {}

export function formatError(cause: Cause.Cause<unknown>) {
  const reason = cause.reasons[0]
  if (cause.reasons.length === 1 && Cause.isFailReason(reason) && reason.error instanceof UserError)
    return `Error: ${reason.error.message}`
  return Cause.pretty(cause)
}
