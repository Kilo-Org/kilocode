// Kilo work for a prompt that will run a turn, called from `SessionPrompt.prompt`
// once the prompt is admitted (not paused, not `noReply`).
import { Effect } from "effect"
import { KiloSessionSteering } from "@/kilocode/session/steering"
import { KiloTaskPauseState } from "@/kilocode/tool/task-pause-state"

export const admit = Effect.fn("KiloSessionAdmission.admit")(function* (
  input: Parameters<typeof KiloSessionSteering.notify>[0],
) {
  // tell the parent when a human steers this subagent
  yield* KiloSessionSteering.notify(input)
  // resume a task paused by an interrupt; the task awaits this turn
  yield* KiloTaskPauseState.admit(input.session.id)
})

export * as KiloSessionAdmission from "./admission"
