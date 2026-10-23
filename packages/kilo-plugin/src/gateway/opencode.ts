export * as OpencodeFreeTier from "./opencode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"

/**
 * OpenCode's free tier rejects clients other than OpenCode, and Kilo promotes the Kilo Gateway. Upstream enables
 * the `opencode` provider with the shared `public` key when the user has no OpenCode credential, and shows its
 * zero-cost models. This plugin runs after the config plugins (phase `post`). Without an OpenCode credential the
 * provider stays inactive; with one, the paid models stay and only the zero-cost models are removed.
 */
export const Plugin = define({
  id: "kilocode.gateway.opencode-free-tier",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(Provider.ID.opencode)
      if (!item) return
      if (item.provider.settings?.apiKey === "public")
        providers.update(item.provider.id, (provider) => {
          provider.activation = "auto"
          delete provider.settings?.apiKey
        })
      for (const model of Array.from(item.models.values()))
        if (!model.cost.some((cost) => cost.input > 0)) providers.models.remove(item.provider.id, model.id)
    })
  }),
})
