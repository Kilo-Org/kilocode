import { Effect } from "effect"
import type { AutonomousState } from "./state"

export namespace AutonomousLog {
  export const MAX = 200

  /** Append an event to the capped state log. Returns the same object for chaining. */
  export function record(state: AutonomousState.Info, event: string, opts?: { taskID?: string; detail?: string }) {
    state.events.push({ time: Date.now(), event, ...(opts?.taskID ? { taskID: opts.taskID } : {}), ...(opts?.detail ? { detail: opts.detail } : {}) })
    if (state.events.length > MAX) state.events.splice(0, state.events.length - MAX)
    state.updated = Date.now()
    return state
  }

  export const info = (state: AutonomousState.Info, event: string, opts?: { taskID?: string; detail?: string }) =>
    Effect.logInfo(`autonomous ${event}`, { sessionID: state.sessionID, ...opts }).pipe(
      Effect.map(() => record(state, event, opts)),
    )
}
