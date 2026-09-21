import { Effect } from "effect"
import type { ExecutionObservation } from "@kilocode/sandbox"

/** Share exit evidence between the observer fiber and consumers waiting for exitCode. */
export function completion(
  exit: Effect.Effect<readonly [number | null, NodeJS.Signals | null]>,
  observer: ExecutionObservation | undefined,
  pid: number | undefined,
) {
  let recorded = false
  return exit.pipe(
    Effect.tap(([code, signal]) =>
      Effect.sync(() => {
        if (!observer || recorded) return
        observer.emit("execution_finished", { boundary: "process", pid, exit_code: code, signal })
        recorded = true
      }),
    ),
  )
}
