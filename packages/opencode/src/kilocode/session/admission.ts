// Kilo work for a prompt that will run a turn, called from `SessionPrompt.prompt`
// once the prompt is admitted (not paused, not `noReply`).
import { Effect } from "effect"
import { KiloSessionSteering } from "@/kilocode/session/steering"
import { KiloTaskPause } from "@/kilocode/tool/task-pause"

export const admit = Effect.fn("KiloSessionAdmission.admit")(function* (
  input: Parameters<typeof KiloSessionSteering.admit>[0],
) {
  // a human steer reminds the child of its task and tells a background task's parent; this runs
  // before the resume so a paused child's reminder says it was interrupted
  yield* KiloSessionSteering.admit(input)
  // resume a task paused by an interrupt; the task awaits this turn
  yield* KiloTaskPause.resume(input.session.id)
})

export * as KiloSessionAdmission from "./admission"
