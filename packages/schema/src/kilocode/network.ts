import { Rpc } from "../rpc.js"
import { Session } from "../session.js"
import { Schema } from "effect"

/** A session step held by the Kilo network policy until connectivity returns. */
export const NetworkWait = Schema.Struct({
  id: Schema.String,
  sessionID: Session.ID,
  message: Schema.String,
  restored: Schema.Boolean,
  time: Schema.Struct({
    created: Schema.Number,
    restored: Schema.optional(Schema.Number),
    /** When the held step retries on its own after the network returned. */
    resume: Schema.optional(Schema.Number),
  }),
})
export type NetworkWait = typeof NetworkWait.Type

export const NetworkResolved = Schema.Struct({
  id: Schema.String,
  sessionID: Session.ID,
  outcome: Schema.Literals(["resumed", "cancelled"]),
})
export type NetworkResolved = typeof NetworkResolved.Type

/** Browser-safe local RPC contract; the policy lives in packages/kilo-cli/src/network-policy.ts. */
export const NetworkRpc = Rpc.define({
  id: "kilocode.network",
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Struct({ waits: Schema.Array(NetworkWait) })),
    },
    resume: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.Struct({ resumed: Schema.Boolean })),
    },
  },
  events: {
    asked: { schema: Schema.toStandardSchemaV1(NetworkWait) },
    restored: { schema: Schema.toStandardSchemaV1(NetworkWait) },
    resolved: { schema: Schema.toStandardSchemaV1(NetworkResolved) },
  },
})
