import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { isKiloAutoID } from "./routed-model"

export const ROUTED_MODEL_PLUGIN_ID = "kilocode.routed-model"
const KILO_GATEWAY_OPENROUTER = "aisdk:@openrouter/ai-sdk-provider"
const KILO_OPENAI_COMPATIBLE = "aisdk:@ai-sdk/openai-compatible"

/**
 * Routes Kilo Auto through Kilo-owned native routes. Their parsers preserve the
 * gateway's response-selected model in terminal provider state, and their
 * settings/body isolation keeps credential metadata out of serialized request
 * bodies on the native transport the session http.request hook covers.
 */
export function createRoutedModelPlugin() {
  return define({
    id: ROUTED_MODEL_PLUGIN_ID,
    effect: Effect.fn("KiloRoutedModel.effect")(function* (ctx) {
      const kiloOpenRouter = import.meta.resolve("@opencode-ai/ai/kilocode/openrouter-routed")
      const kiloOpenAICompatible = import.meta.resolve("@opencode-ai/ai/kilocode/openai-compatible-routed")
      yield* ctx.catalog.transform((catalog) => {
        for (const record of catalog.provider.list()) {
          if (record.provider.id !== "kilo") continue
          for (const model of record.models.values()) {
            if (!isKiloAutoID(model.id)) continue
            catalog.model.update(record.provider.id, model.id, (draft) => {
              if (draft.package === KILO_GATEWAY_OPENROUTER) {
                draft.package = kiloOpenRouter
                return
              }
              if (record.provider.package !== KILO_OPENAI_COMPATIBLE) return
              if (draft.package !== undefined && draft.package !== KILO_OPENAI_COMPATIBLE) return
              draft.package = kiloOpenAICompatible
            })
          }
        }
      })
    }),
  })
}
