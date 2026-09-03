export * as SessionStatusEvent from "./session-status-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { NonNegativeInt } from "./schema"
import { SessionID } from "./session-id"

const QuestionID = Schema.String.check(Schema.isStartsWith("que")).pipe(Schema.brand("QuestionID")) // kilocode_change

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
    working: optional(Schema.Boolean), // kilocode_change
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    working: optional(Schema.Boolean), // kilocode_change
    attempt: NonNegativeInt,
    message: Schema.String,
    action: optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
    working: optional(Schema.Boolean), // kilocode_change
  }),
  // kilocode_change start - represent a session paused for an offline Kilo question
  Schema.Struct({
    type: Schema.Literal("offline"),
    working: optional(Schema.Boolean),
    requestID: QuestionID,
    message: Schema.String,
  }),
  // kilocode_change end
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Status = Event.define({
  type: "session.status",
  schema: {
    sessionID: SessionID,
    status: Info,
  },
})

// kilocode_change start
export const Working = Event.define({
  type: "session.working",
  schema: {
    sessionID: SessionID,
    status: Info,
  },
})
// kilocode_change end

// deprecated
export const Idle = Event.define({
  type: "session.idle",
  schema: {
    sessionID: SessionID,
  },
})

export const Definitions = Event.inventory(Status, Idle, Working) // kilocode_change
