export * as KiloQuestion from "./question.js"

import { Schema } from "effect"
import { Question } from "../question.js"
import { optional } from "../schema.js"

// Kilo client hints on a question option. The question plugin in packages/kilo-plugin accepts them in the `question`
// tool input and puts them on the pending form under `metadata.kilocode`; clients import this contract from
// `@opencode/schema/kilocode/question`. The hints never change the answer the model receives, which stays labels only.
// The descriptions annotate the inner string: an annotation on the `optional` wrapper does not reach the JSON Schema
// that the model receives.
// kilo_port(unattributed:schema/v1:04e56db46d79)
const hints = {
  labelKey: optional(
    Schema.String.annotate({
      description: "Optional i18n key for the label; clients translate and still reply with `label`",
    }),
  ),
  descriptionKey: optional(Schema.String.annotate({ description: "Optional i18n key for the description" })),
  mode: optional(
    Schema.String.annotate({
      description: "Optional agent/mode name to pre-select in the UI when this option is picked",
    }),
  ),
}

export const Hint = Schema.Struct(hints).annotate({ identifier: "KiloQuestion.Hint" })
export interface Hint extends Schema.Schema.Type<typeof Hint> {}

// The upstream option fields are repeated here because the annotated `Question.Prompt` options array does not expose
// its item schema; the plugin's parity test fails when they drift from upstream.
export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
  ...hints,
}).annotate({ identifier: "KiloQuestion.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

export const Prompt = Schema.Struct({
  ...Question.Prompt.fields,
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
}).annotate({ identifier: "KiloQuestion.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

/**
 * The hints of a pending question form, at `metadata.kilocode.options` of the form that `GET /api/form` returns:
 * form field key (`q0`, `q1`, ...) to option value (the option label) to the option's hints. Only options with at
 * least one hint are listed, and the key is absent when no option has a hint.
 */
export const FormHints = Schema.Record(Schema.String, Schema.Record(Schema.String, Hint)).annotate({
  identifier: "KiloQuestion.FormHints",
})
export type FormHints = typeof FormHints.Type

export const FormMetadata = Schema.Struct({
  kilocode: Schema.Struct({ options: FormHints }),
}).annotate({ identifier: "KiloQuestion.FormMetadata" })
export interface FormMetadata extends Schema.Schema.Type<typeof FormMetadata> {}
