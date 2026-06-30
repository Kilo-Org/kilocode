import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"

export const Changed = BusEvent.define(
  "sandbox.status.changed",
  Schema.Struct({
    sessionID: SessionID,
    directory: Schema.String,
    enabled: Schema.Boolean,
    available: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    version: Schema.Int,
  }),
)
