import { Schema } from "effect"

/** Shared by configuration defaults and per-call image tool arguments. */
export const Options = Schema.Struct({
  size: Schema.optional(Schema.String.check(Schema.isPattern(/^(auto|[1-9]\d*x[1-9]\d*)$/))).annotate({
    description: "Custom image output size: auto or WIDTHxHEIGHT. Supported dimensions depend on the server.",
  }),
  background: Schema.optional(Schema.Literals(["auto", "opaque", "transparent"])).annotate({
    description: "Custom image background mode, if supported by the server.",
  }),
  seed: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))).annotate({
    description: "Custom image random seed. Omit to use the server default.",
  }),
  steps: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))).annotate(
    {
      description: "Custom image diffusion steps. Supported ranges depend on the server; Gufo accepts 2–100.",
    },
  ),
})

export type Options = Schema.Schema.Type<typeof Options>
