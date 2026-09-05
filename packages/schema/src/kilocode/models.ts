export * as KiloModels from "./models.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

export const Entry = Schema.Struct({
  id: Schema.String,
  recommendedIndex: Schema.optionalKey(Schema.Finite),
  autoRouting: Schema.optionalKey(Schema.Struct({ models: Schema.Array(Schema.String) })),
  hasUserByokAvailable: Schema.optionalKey(Schema.Boolean),
  mayTrainOnYourPrompts: Schema.optionalKey(Schema.Boolean),
})
export type Entry = typeof Entry.Type

export const Definition = Rpc.define({
  id: "kilocode.models",
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Array(Entry)),
      errors: {
        "kilocode.gateway": Schema.toStandardSchemaV1(Schema.Undefined),
        "kilocode.gateway_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
      },
    },
  },
  events: {},
})
