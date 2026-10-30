export * as KiloConfigPolicy from "./policy.js"

import { Config } from "@opencode/schema/config"
import { optional } from "@opencode/schema/schema"
import path from "path"
import { Effect, Option, Schema } from "effect"
import type { Interface } from "../../config.js"
import type { ConfigNormalize } from "../../config/normalize.js"

export const AgentPlugins = Schema.Struct({
  paths: Schema.String.pipe(Schema.Array, optional).annotate({
    description:
      "Agent Plugin directories to load, each a plugin root holding plugin.json. Relative paths resolve from the config file; ~/ expands to the home directory",
  }),
  disabled: Schema.String.pipe(Schema.Array, optional).annotate({
    description: "Names of Agent Plugins not to load",
  }),
}).annotate({ identifier: "KiloConfigPolicy.AgentPlugins" })
export type AgentPlugins = typeof AgentPlugins.Type

export class Info extends Config.Info.extend<Info>("KiloConfigPolicy.Info")({
  hide_prompt_training_models: Schema.Boolean.pipe(optional).annotate({
    description: "Hide Kilo models that can use prompts for training and deny provider data collection",
  }),
  agent_plugins: AgentPlugins.pipe(optional).annotate({
    description:
      "Agent Plugins (agent-plugins.org) to load besides the plugins/ directories of ~/.agents and the project's .agents",
  }),
}) {}

const decode = Schema.decodeUnknownOption(Info, { errors: "all", onExcessProperty: "ignore" })

/** Decode Kilo settings alongside the canonical fields produced by upstream normalization. */
export function parse(
  input: unknown,
  normalized: Readonly<Record<string, unknown>>,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
) {
  // A malformed Kilo-only field must not discard canonical managed permission policies or the other Kilo fields.
  const raw = {
    ...field(
      input,
      "hide_prompt_training_models",
      Schema.Boolean,
      "ignored invalid hide_prompt_training_models; expected a boolean (true or false), so prompt-training protection was not applied from this field",
      report,
    ),
    ...field(
      input,
      "agent_plugins",
      AgentPlugins,
      'ignored invalid agent_plugins; expected an object with string arrays "paths" and "disabled", so no Agent Plugin settings were applied from this field',
      report,
    ),
  }
  // Managed policy splitting clears optional fields with undefined; the encoded schema requires omitted keys.
  return Option.getOrUndefined(
    decode(Object.fromEntries(Object.entries({ ...normalized, ...raw }).filter(([, value]) => value !== undefined))),
  )
}

function field<K extends string, S extends Schema.ConstraintDecoder<unknown>>(
  input: unknown,
  key: K,
  schema: S,
  message: string,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
): Partial<Record<K, S["Type"]>> {
  const value = typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined
  if (value === undefined) return {}
  const decoded = Schema.decodeUnknownOption(schema)(value)
  if (Option.isSome(decoded)) return { [key]: decoded.value } as Partial<Record<K, S["Type"]>>
  report?.({ path: [key], kind: "invalid", message })
  return {}
}

/** Read only effective location config entries, never plugin storage or a user's ordinary config store. */
export function fromEntries(entries: readonly Config.Entry[]) {
  return {
    hide_prompt_training_models: documents(entries).reduce(
      (value, document) => document.info.hide_prompt_training_models ?? value,
      false,
    ),
  }
}

export const get = (config: Interface) => config.entries().pipe(Effect.map(fromEntries))

/**
 * The effective `agent_plugins` settings: every document adds its plugin paths and disabled names. A relative path
 * resolves from the directory of the config file that names it; documents without a file keep it relative for the
 * caller to resolve.
 */
export function agentPlugins(entries: readonly Config.Entry[]) {
  return {
    paths: documents(entries).flatMap((document) =>
      (document.info.agent_plugins?.paths ?? []).map((item) =>
        document.file && !path.isAbsolute(item) && !item.startsWith("~/")
          ? path.join(path.dirname(document.file), item)
          : item,
      ),
    ),
    disabled: [...new Set(documents(entries).flatMap((document) => document.info.agent_plugins?.disabled ?? []))],
  }
}

function documents(entries: readonly Config.Entry[]) {
  return entries.flatMap((entry) =>
    entry.type === "document" && entry.info instanceof Info ? [{ info: entry.info, file: entry.path }] : [],
  )
}
