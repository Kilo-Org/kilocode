import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const OpenAIPlugin = PluginV2.define({
  id: PluginV2.ID.make("openai"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/openai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai"))
        evt.sdk = mod.createOpenAI(evt.options)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        // kilocode_change start - also route custom-named providers that reuse the
        // @ai-sdk/openai package (e.g. a self-hosted proxy configured with
        // npm: "@ai-sdk/openai" instead of "@ai-sdk/openai-compatible") through
        // Responses, not just the literal built-in "openai" provider. Without this,
        // such a provider silently falls back to the plain chat-completions
        // language model and loses separated reasoning content for reasoning
        // models - matches how native-request.ts already dispatches on npm
        // package rather than provider ID.
        const isOpenAI =
          evt.model.providerID === ProviderV2.ID.openai ||
          (evt.model.api.type === "aisdk" && evt.model.api.package === "@ai-sdk/openai")
        if (!isOpenAI) return
        // kilocode_change end
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai") continue
          if (!item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) continue
          evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
            // OpenAIPlugin sends OpenAI models through Responses; this alias is a
            // chat-completions-only model, so hide it only from OpenAI's catalog.
            model.enabled = false
          })
        }
      }),
    }
  }),
})
