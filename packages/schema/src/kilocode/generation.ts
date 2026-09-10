import { Rpc } from "../rpc.js"
import { Model } from "../model.js"
import { Schema } from "effect"

const textInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    prompt: Schema.String,
    model: Schema.optional(Model.Ref),
  }),
)

const textOutput = Schema.toStandardSchemaV1(
  Schema.Struct({
    text: Schema.String,
  }),
)

const rpcErrors = {
  "kilocode.generation.error": Schema.toStandardSchemaV1(Schema.Undefined),
}

export const GenerationRpc = Rpc.define({
  id: "kilocode.generation",
  methods: {
    text: {
      input: textInput,
      output: textOutput,
      errors: rpcErrors,
    },
  },
  events: {},
})

export type GenerationRpc = typeof GenerationRpc
