export * as KiloSession from "./session.js"

import { Schema } from "effect"
import { Location } from "../location.js"
import { Rpc } from "../rpc.js"
import { Session } from "../session.js"
import { SessionTransfer } from "../session-transfer.js"
import { optional } from "../schema.js"

export interface Share extends Schema.Schema.Type<typeof Share> {}
export const Share = Schema.Struct({
  url: Schema.String,
}).annotate({ identifier: "KiloSession.Share" })

export interface ShareInput extends Schema.Schema.Type<typeof ShareInput> {}
export const ShareInput = Schema.Struct({
  sessionID: Session.ID,
  data: SessionTransfer.Data,
}).annotate({ identifier: "KiloSession.ShareInput" })

export interface ForkInput extends Schema.Schema.Type<typeof ForkInput> {}
export const ForkInput = Schema.Struct({
  share: Schema.String.check(Schema.isMinLength(1)),
  location: Location.Ref.pipe(optional),
}).annotate({ identifier: "KiloSession.ForkInput" })

const errors = {
  "kilocode.session": Schema.toStandardSchemaV1(Schema.Undefined),
  "kilocode.session_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
}

export const Definition = Rpc.define({
  id: "kilocode.session",
  methods: {
    share: {
      input: Schema.toStandardSchemaV1(ShareInput),
      output: Schema.toStandardSchemaV1(Share),
      errors,
    },
    unshare: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Session.ID })),
      output: Schema.toStandardSchemaV1(Schema.Struct({})),
      errors,
    },
    fork: {
      input: Schema.toStandardSchemaV1(ForkInput),
      output: Schema.toStandardSchemaV1(Session.Info),
      errors,
    },
  },
  events: {},
})
