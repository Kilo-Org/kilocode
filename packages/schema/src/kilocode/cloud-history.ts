export * as KiloCloudHistoryRpc from "./cloud-history.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { Session } from "../session.js"
import { SessionMessage } from "../session-message.js"

const portable = Schema.toStandardSchemaV1
export const CloudID = Schema.String.check(Schema.isPattern(/^ses[A-Za-z0-9_-]{1,253}$/))
const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))
export const List = Schema.Struct({
  cursor: Schema.optional(Cursor),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
})
export const Transfer = Schema.Struct({
  info: Schema.toEncoded(Session.Info),
  messages: Schema.Array(Schema.toEncoded(SessionMessage.Info)),
})
const errors = { failed: portable(Schema.Undefined) }

export const Definition = Rpc.define({
  id: "kilocode.cloud-history",
  methods: {
    capabilities: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ repositoryFilter: Schema.Boolean, publicLinks: Schema.Boolean })),
    },
    list: {
      input: portable(List),
      output: portable(
        Schema.Struct({
          items: Schema.Array(Schema.Struct({ sessionID: CloudID, createdAt: Schema.Int })),
          cursor: Schema.NullOr(Cursor),
        }),
      ),
      errors,
    },
    /** A new, detached local identity for experimental.session.import. No queued work or remote permissions. */
    download: { input: portable(Schema.Struct({ sessionID: CloudID })), output: portable(Transfer), errors },
  },
  events: {},
})
