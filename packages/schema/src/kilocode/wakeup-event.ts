export * as WakeupEvent from "./wakeup-event"

import { Schema } from "effect"
import { Event } from "../event"
import { NonNegativeInt } from "../schema"
import { SessionID } from "../session-id"

/** How many wakeups the session still holds after a schedule, cancel, or fire. */
export const Pending = Event.define({
  type: "session.wakeup",
  schema: {
    sessionID: SessionID,
    pending: NonNegativeInt,
  },
})

/** Shared payload struct so the event and the wakeups route cannot drift. */
export const PendingInfo = Pending.data

export const Definitions = Event.inventory(Pending)
