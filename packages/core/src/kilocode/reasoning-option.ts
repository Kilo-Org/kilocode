import { Schema } from "effect"

export const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.Array(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("toggle"),
  }),
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optional(Schema.Finite),
    max: Schema.optional(Schema.Finite),
  }),
])

export const ReasoningOptions = Schema.Array(ReasoningOption)
export const ConfigReasoningOptions = Schema.mutable(
  Schema.Array(
    Schema.Union([
      Schema.Struct({
        type: Schema.Literal("effort"),
        values: Schema.mutable(Schema.Array(Schema.String)),
      }),
      Schema.Struct({
        type: Schema.Literal("toggle"),
      }),
      Schema.Struct({
        type: Schema.Literal("budget_tokens"),
        min: Schema.optional(Schema.Finite),
        max: Schema.optional(Schema.Finite),
      }),
    ]),
  ),
)
export type ReasoningOption = Schema.Schema.Type<typeof ReasoningOption>
export type ReasoningOptions = Schema.Schema.Type<typeof ReasoningOptions>
export type ConfigReasoningOptions = Schema.Schema.Type<typeof ConfigReasoningOptions>
