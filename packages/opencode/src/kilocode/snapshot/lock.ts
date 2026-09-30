// EffectFlock serializes the whole snapshot repository across the CLI and extension processes.
// Git's own `index.lock` is left to git: a command that cannot take it fails with a non-zero exit
// and says so on stderr, which the call sites log.
import { Effect } from "effect"
import type { EffectFlock } from "@opencode-ai/core/util/effect-flock"

export namespace KiloSnapshotLock {
  /**
   * Treat a failure to take the cross-process snapshot lock as a defect, while leaving the body's
   * own errors in the error channel for callers that report them.
   */
  export const dieOnLockError = <A, E, R>(fx: Effect.Effect<A, E | EffectFlock.LockError, R>) =>
    fx.pipe(Effect.catchTag("LockTimeoutError", Effect.die), Effect.catchTag("LockCompromisedError", Effect.die))
}
