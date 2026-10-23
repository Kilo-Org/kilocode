export * as SessionHostEvent from "./session-host-event"

import { Schema } from "effect"
import { Event } from "../event"

/**
 * Hosted session availability on the local global event stream. Identity is the
 * provider-neutral composite pair; native turn events stay session-scoped on the
 * routed event stream and are never republished here.
 */
export const Availability = Event.define({
  type: "session.host.availability",
  schema: {
    providerID: Schema.String,
    sessionID: Schema.optional(Schema.String),
    state: Schema.Literals(["available", "unavailable"]),
    reason: Schema.optional(Schema.String),
  },
})

export const AvailabilityInfo = Availability.data

export const Definitions = Event.inventory(Availability)
