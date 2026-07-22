import { BusEvent } from "@/bus/bus-event"
import { MessageID, SessionID } from "@/session/schema"
import { Schema } from "effect"

const CloseReason = Schema.Literals(["completed", "error", "interrupted"])

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
}

export type KiloSessionCloseReason = Schema.Schema.Type<typeof CloseReason>
