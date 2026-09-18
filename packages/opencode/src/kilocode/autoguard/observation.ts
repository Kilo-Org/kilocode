import { Effect } from "effect"
import { ExecutionObservation as Observation } from "@kilocode/sandbox"
export { Observation }
export const check = () =>
  Effect.gen(function* () {
    ;(yield* Observation)?.verify()
  })
export function event(kind: "execution_started" | "execution_finished", detail: Record<string, unknown> = {}) {
  return Effect.gen(function* () {
    ;(yield* Observation)?.emit(kind, detail)
  })
}
