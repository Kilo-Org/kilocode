export * as KiloModels from "./models.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

export const Entry = Schema.Struct({
  id: Schema.String,
  recommendedIndex: Schema.optionalKey(Schema.Finite),
  autoRouting: Schema.optionalKey(Schema.Struct({ models: Schema.Array(Schema.String) })),
  hasUserByokAvailable: Schema.optionalKey(Schema.Boolean),
  mayTrainOnYourPrompts: Schema.optionalKey(Schema.Boolean),
  // Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts:48 — optional
  // per-model Terminal Bench 2.0 metadata. Display-only: absent or malformed means
  // no section, never a model drop or an invented value.
  terminalBench: Schema.optionalKey(Schema.Struct({ overallScore: Schema.Finite, avgAttemptCostUsd: Schema.Finite })),
  description: Schema.optionalKey(Schema.String),
  reasoning: Schema.optionalKey(Schema.Boolean),
  family: Schema.optionalKey(Schema.String),
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
