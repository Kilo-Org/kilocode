import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
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
}

export type KiloSessionCloseReason = Schema.Schema.Type<typeof CloseReason>
