export * as KiloConfigPolicy from "./policy.js"

import { Config } from "@opencode/schema/config"
import { optional } from "@opencode/schema/schema"
import { Effect, Option, Schema } from "effect"
import type { Interface } from "../../config.js"
import type { ConfigNormalize } from "../../config/normalize.js"

export class Info extends Config.Info.extend<Info>("KiloConfigPolicy.Info")({
  hide_prompt_training_models: Schema.Boolean.pipe(optional).annotate({
    description: "Hide Kilo models that can use prompts for training and deny provider data collection",
  }),
}) {}

const decode = Schema.decodeUnknownOption(Info, { errors: "all", onExcessProperty: "ignore" })
const policy = Schema.Struct({ hide_prompt_training_models: Schema.optional(Schema.Boolean) })

/** Decode Kilo settings alongside the canonical fields produced by upstream normalization. */
export function parse(
  input: unknown,
  normalized: Readonly<Record<string, unknown>>,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
) {
  // A malformed Kilo-only field must not discard canonical managed permission policies.
  const decoded = Schema.decodeUnknownOption(policy)(input)
  if (Option.isNone(decoded))
    report?.({
      path: ["hide_prompt_training_models"],
      kind: "invalid",
      message:
        "ignored invalid hide_prompt_training_models; expected a boolean (true or false), so prompt-training protection was not applied from this field",
    })
  const raw = Option.getOrElse(decoded, () => ({}))
  // Managed policy splitting clears optional fields with undefined; the encoded schema requires omitted keys.
  return Option.getOrUndefined(
    decode(Object.fromEntries(Object.entries({ ...normalized, ...raw }).filter(([, value]) => value !== undefined))),
  )
}

/** Read only effective location config entries, never plugin storage or a user's ordinary config store. */
export function fromEntries(entries: readonly Config.Entry[]) {
  return {
    hide_prompt_training_models: entries.reduce(
      (value, entry) =>
        entry.type === "document" && entry.info instanceof Info && entry.info.hide_prompt_training_models !== undefined
          ? entry.info.hide_prompt_training_models
          : value,
      false,
    ),
  }
}

export const get = (config: Interface) => config.entries().pipe(Effect.map(fromEntries))
