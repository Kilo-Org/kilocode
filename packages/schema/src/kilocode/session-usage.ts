import { Rpc } from "../rpc.js"
import { Model } from "../model.js"
import { Money } from "../money.js"
import { Provider } from "../provider.js"
import { Session } from "../session.js"
import { TokenUsage } from "../token-usage.js"
import { Schema } from "effect"

const Usage = Schema.Struct({
  steps: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  cost: Money.USD,
  tokens: TokenUsage.Info,
})

const ModelUsage = Schema.Struct({
  providerID: Provider.ID,
  modelID: Model.ID,
  ...Usage.fields,
})

/** Durable model usage for the root and descendants of one session. */
export const SessionUsage = Schema.Struct({
  sessionIDs: Schema.Array(Session.ID),
  totals: Usage,
  models: Schema.Array(ModelUsage),
})
export type SessionUsage = typeof SessionUsage.Type

const input = Schema.Struct({ sessionID: Session.ID })
const error = { "kilocode.session-usage": Schema.toStandardSchemaV1(Schema.Undefined) }

/** Browser-safe local RPC contract; the host reader stays in session-usage.ts. */
export const SessionUsageRpc = Rpc.define({
  id: "kilocode.session-usage",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(input),
      output: Schema.toStandardSchemaV1(SessionUsage),
      errors: error,
    },
  },
  events: {},
})
