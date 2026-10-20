import { BusEvent } from "@/bus/bus-event"
import { MessageID, SessionID } from "@/session/schema"
import { Schema } from "effect"

// "superseded": the turn handed off to a queued follow-up after draining its
// current step. Distinct from "interrupted" so clients do not surface a
// premature-stop warning for a deliberate queue handoff.
const CloseReason = Schema.Literals(["completed", "error", "interrupted", "superseded"])

// Per-target delivery state for a mid-run steering update. "delivered" means the
// notice reached the child's context, not that the child complied.
const SteeringState = Schema.Literals(["pending", "delivered", "escalated", "stale"])

export type KiloSteeringState = Schema.Schema.Type<typeof SteeringState>

export type KiloSteeringChanged = {
  sessionID: SessionID
  messageID: MessageID
  revision: number
  targets: Array<{ sessionID: SessionID; state: KiloSteeringState }>
}

export const KiloSessionEvent = {
  TurnOpen: BusEvent.define(
    "session.turn.open",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
  TurnClose: BusEvent.define(
    "session.turn.close",
    Schema.Struct({
      sessionID: SessionID,
      parentID: Schema.optional(SessionID),
      reason: CloseReason,
    }),
  ),
  // FIFO snapshot of queued (waiting, not-yet-running)
  // user message IDs per session, for remote clients (mobile) to show
  // "Queued" badges. The currently-running turn's own message is not included.
  QueueChanged: BusEvent.define(
    "session.queue.changed",
    Schema.Struct({
      sessionID: SessionID,
      queued: Schema.Array(MessageID),
    }),
  ),
  // Delivery status of a mid-run user update fanned out to active subagents of
  // the origin session. Published on every transition that changes a target.
  SteeringChanged: BusEvent.define(
    "session.steering.changed",
    Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID,
      revision: Schema.Number,
      targets: Schema.Array(Schema.Struct({ sessionID: SessionID, state: SteeringState })),
    }),
  ),
}

export type KiloSessionCloseReason = Schema.Schema.Type<typeof CloseReason>
