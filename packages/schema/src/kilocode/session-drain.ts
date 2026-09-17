import { Schema } from "effect"
import { Event } from "../event"
import { SessionID } from "../session-id"

export const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

export const Drained = Event.define({
  type: "session.drained",
  schema: { sessionID: SessionID, token: Token },
})

export const Interrupted = Event.define({
  type: "session.drain.interrupted",
  schema: { sessionID: SessionID },
})

export const Definitions = Event.inventory(Drained, Interrupted)
