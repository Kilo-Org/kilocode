export * as GatewayOptions from "./options.js"

import type { KiloModels } from "@kilocode/gateway-core"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"

// Config model transforms run after the Gateway. Normalize their final settings before native hooks read them.
export const Plugin = define({
  id: "kilocode.gateway.options",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.model.transform((editor) => {
      for (const model of editor.list("kilo")) {
        const provider =
          model.package === "@opencode/ai/providers/anthropic"
            ? "anthropic"
            : model.package === "@opencode/ai/providers/openai"
              ? "openai"
              : model.package === "@opencode/ai/providers/openai-compatible"
                ? "openai-compatible"
                : undefined
        if (!provider) continue
        model.settings = {
          ...model.settings,
          ...request(provider, [editor.provider.get("kilo")?.provider.settings, model.settings]),
        }
        for (const variant of model.variants) {
          if (variant.settings) variant.settings = lower(provider, variant.settings)
        }
      }
    })
  }),
})

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
      ...(shared.reasoning?.enabled !== undefined
        ? { thinking: { type: shared.reasoning.enabled ? "adaptive" : "disabled" } }
        : {}),
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
