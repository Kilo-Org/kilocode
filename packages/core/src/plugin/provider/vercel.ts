import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider" // kilocode_change

export const VercelPlugin = PluginV2.define({
  id: PluginV2.ID.make("vercel"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/vercel") continue
          if (item.provider.id !== ProviderV2.ID.make("vercel")) continue // kilocode_change
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["http-referer"] = "https://kilo.ai/" // kilocode_change
            provider.request.headers["x-title"] = "Kilo Code" // kilocode_change
          })
        }
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/vercel") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/vercel"))
        evt.sdk = mod.createVercel(evt.options)
      }),
    }
  }),
})
