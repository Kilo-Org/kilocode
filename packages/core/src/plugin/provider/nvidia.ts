import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const NvidiaPlugin = PluginV2.define({
  id: PluginV2.ID.make("nvidia"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.make("nvidia")) return
        evt.provider.options.headers["HTTP-Referer"] = "https://kilo.ai/" // kilocode_change
        evt.provider.options.headers["X-Title"] = "Kilo Code" // kilocode_change
        evt.provider.options.headers["X-BILLING-INVOKE-ORIGIN"] ??= "KiloCode" // kilocode_change
      }),
    }
  }),
})
