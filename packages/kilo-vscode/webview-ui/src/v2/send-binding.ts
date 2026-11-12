// The session-bound decisions of a send. A revert settle can outlive the tab the send came from, so these are read for
// the session the composer belonged to, not for whatever tab the user is looking at now.
import type { SendMode } from "./pending-actions"

/**
 * What a send does to the session it was pressed in. `same` says the active tab is still that session, which is the
 * only case where the live selection and the goal of the open session describe this send. With the tab switched, the
 * goal of the pinned session is not readable, so a steer waits for the next step boundary instead of stopping a run
 * that may belong to an active goal. Stop and "stop and send" keep stopping the pinned run.
 */
export function sendBinding(input: {
  /** The session the send was pressed in; undefined for a new draft. */
  pinned: string | undefined
  /** The session the view selects now. */
  active: string | undefined
  running: boolean
  goalActive: boolean
  steerInterrupts: boolean
  mode: SendMode
}) {
  const same = input.pinned === input.active
  return {
    same,
    interrupt:
      input.running &&
      (input.mode === "now" ||
        (input.mode === "steer" && same && !input.goalActive && input.steerInterrupts)),
  }
}
