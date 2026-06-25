import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider" // kilocode_change

export const NvidiaPlugin = PluginV2.define({
  id: PluginV2.ID.make("nvidia"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.endpoint.type !== "aisdk") continue
          if (item.provider.endpoint.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.endpoint.url !== "https://integrate.api.nvidia.com/v1") continue
          if (item.provider.id !== ProviderV2.ID.make("nvidia")) continue // kilocode_change
          evt.provider.update(item.provider.id, (provider) => {
            provider.options.headers["HTTP-Referer"] = "https://relay.dev/" // relay change
            // relay change start
            provider.options.headers["X-Title"] = "Relay"
            provider.options.headers["X-BILLING-INVOKE-ORIGIN"] ??= "Relay"
            // relay change end
          })
        }
      }),
    }
  }),
})
