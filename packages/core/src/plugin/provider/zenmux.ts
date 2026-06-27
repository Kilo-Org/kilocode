import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider" // kilocode_change

export const ZenmuxPlugin = PluginV2.define({
  id: PluginV2.ID.make("zenmux"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.endpoint.type !== "aisdk") continue
          if (item.provider.endpoint.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.endpoint.url !== "https://zenmux.ai/api/v1") continue
          if (item.provider.id !== ProviderV2.ID.make("zenmux")) continue // kilocode_change
          evt.provider.update(item.provider.id, (provider) => {
            provider.options.headers["HTTP-Referer"] ??= "https://kilo.ai/" // kilocode_change
            provider.options.headers["X-Title"] ??= "Kilo Code" // kilocode_change
          })
        }
      }),
    }
  }),
})
