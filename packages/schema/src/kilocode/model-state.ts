export * as ModelStateRpc from "./model-state.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

const name = Schema.String.check(Schema.isMinLength(1))
export const Selection = Schema.Struct({ providerID: name, modelID: name })
export const Selections = Schema.Record(Schema.String, Selection)
export const SetInput = Schema.Struct({ agent: name, providerID: name, modelID: name })
export const ClearInput = Schema.Struct({ agent: name })
const output = Schema.toStandardSchemaV1(Selections)
const empty = Schema.toStandardSchemaV1(Schema.Struct({}))
const errors = { "kilocode.model-state": Schema.toStandardSchemaV1(Schema.Undefined) }

export const Definition = Rpc.define({
  id: "kilocode.model-state",
  methods: {
    list: { input: empty, output, errors },
    set: { input: Schema.toStandardSchemaV1(SetInput), output, errors },
    clear: { input: Schema.toStandardSchemaV1(ClearInput), output, errors },
    reset: { input: empty, output, errors },
  },
  events: {},
})
