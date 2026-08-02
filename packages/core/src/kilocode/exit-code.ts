import { constants } from "node:os"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"

// A process terminated by a signal produces a null exit code (see the "exit"
// event on node:child_process). Report the conventional 128 + signum code
// (e.g. 139 for SIGSEGV) instead of failing, which left consumers like the
// bash tool waiting on a numeric code that never arrived.
export const settle = ([code, signal]: readonly [code: number | null, signal: NodeJS.Signals | null]) => {
  if (Predicate.isNotNull(code)) return Effect.succeed(ExitCode(code))
  if (Predicate.isNotNull(signal) && signal in constants.signals) {
    return Effect.succeed(ExitCode(128 + constants.signals[signal]))
  }
  return Effect.succeed(ExitCode(1))
}
