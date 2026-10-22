export * as GatewayOptions from "./options.js"

import type { KiloModels } from "@kilocode/gateway-core"
import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(
  Schema.Struct({
    reasoning: Schema.optionalKey(
      Schema.Struct({
        enabled: Schema.optionalKey(Schema.Boolean),
        effort: Schema.optionalKey(Schema.String),
      }),
    ),
    verbosity: Schema.optionalKey(Schema.String),
  }),
)

// Main's kiloProviderOptions accepts the shared Gateway contract for every dialect.
// Native settings remain authoritative when they are supplied explicitly.
export function lower(provider: KiloModels.AISDKProvider | undefined, options: Readonly<Record<string, unknown>>) {
  const shared = Option.getOrUndefined(decode(options))
  if (!shared || !provider || provider === "openrouter") return { ...options }
  if (provider === "anthropic")
    return {
      ...(shared.reasoning ? { thinking: { type: shared.reasoning.enabled ? "adaptive" : "disabled" } } : {}),
      ...(shared.verbosity !== undefined ? { effort: shared.verbosity } : {}),
      ...options,
    }
  return {
    ...(shared.reasoning?.effort !== undefined ? { reasoningEffort: shared.reasoning.effort } : {}),
    ...(shared.verbosity !== undefined ? { textVerbosity: shared.verbosity } : {}),
    ...(provider === "openai" && shared.reasoning?.enabled !== undefined
      ? { forceReasoning: shared.reasoning.enabled }
      : {}),
    ...options,
  }
}

export function request(
  provider: KiloModels.AISDKProvider | undefined,
  layers: readonly (Readonly<Record<string, unknown>> | undefined)[],
) {
  const keys = new Set([
    "reasoning",
    "verbosity",
    "thinking",
    "effort",
    "reasoningEffort",
    "textVerbosity",
    "forceReasoning",
    "store",
  ])
  return Object.assign(
    {},
    ...layers.map((layer) =>
      lower(provider, Object.fromEntries(Object.entries(layer ?? {}).filter(([key]) => keys.has(key)))),
    ),
  )
}
