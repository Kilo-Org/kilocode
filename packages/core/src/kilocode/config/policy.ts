export * as KiloConfigPolicy from "./policy.js"

import { Config } from "@opencode/schema/config"
import { optional } from "@opencode/schema/schema"
import { Effect, Option, Schema } from "effect"
import type { Interface } from "../../config.js"

export class Info extends Config.Info.extend<Info>("KiloConfigPolicy.Info")({
  hide_prompt_training_models: Schema.Boolean.pipe(optional).annotate({
    description: "Hide Kilo models that can use prompts for training and deny provider data collection",
  }),
}) {}

const decode = Schema.decodeUnknownOption(Info, { errors: "all", onExcessProperty: "ignore" })
const policy = Schema.Struct({ hide_prompt_training_models: Schema.optional(Schema.Unknown) })

/** Decode Kilo settings alongside the canonical fields produced by upstream normalization. */
export function parse(input: unknown, normalized: Readonly<Record<string, unknown>>) {
  const raw = Schema.decodeUnknownOption(policy)(input)
  if (Option.isNone(raw)) return
  // Managed policy splitting clears optional fields with undefined; the encoded schema requires omitted keys.
  return Option.getOrUndefined(
    decode(
      Object.fromEntries(Object.entries({ ...normalized, ...raw.value }).filter(([, value]) => value !== undefined)),
    ),
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
