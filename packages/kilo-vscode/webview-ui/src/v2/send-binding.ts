// The session-bound decisions of a send. A revert settle can outlive the tab the send came from, so these are read for
// the session the composer belonged to, not for whatever tab the user is looking at now.
import type { SendMode } from "./pending-actions"

/**
 * What a send does to the session it was pressed in. `same` says the active tab is still that session, which is the
 * only case where the live model selection describes this send. Ordinary steers use the inbox even if the transcript
 * still shows reasoning: a tool may already have started on the server. Only an explicit "stop and send" interrupts.
 */
export function sendBinding(input: {
  /** The session the send was pressed in; undefined for a new draft. */
  pinned: string | undefined
  /** The session the view selects now. */
  active: string | undefined
  running: boolean
  mode: SendMode
}) {
  return {
    same: input.pinned === input.active,
    delivery: input.mode === "queue" ? "queue" : "steer",
    interrupt: input.running && input.mode === "now",
  } as const
}
