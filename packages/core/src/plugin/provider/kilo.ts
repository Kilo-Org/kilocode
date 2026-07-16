import { createKilo, KILO_OPENROUTER_BASE } from "@kilocode/kilo-gateway" // kilocode_change
import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider" // kilocode_change

const id = ProviderV2.ID.make("kilo") // kilocode_change

export const KiloPlugin = PluginV2.define({
  id: PluginV2.ID.make("kilo"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.id !== id) continue // kilocode_change
          evt.provider.update(item.provider.id, (provider) => {
            // kilocode_change start
            const options = provider.request.body
            const token = options.kilocodeToken ?? options.apiKey ?? process.env.KILO_API_KEY
            const org = process.env.KILO_ORG_ID ?? options.kilocodeOrganizationId

            provider.api = {
              type: "aisdk",
              package: "@kilocode/kilo-gateway",
              url: KILO_OPENROUTER_BASE,
            }
            // kilocode_change end
            provider.request.headers["HTTP-Referer"] = "https://kilo.ai/"
            // kilocode_change start
            provider.request.headers["X-Title"] = "Kilo Code"
            options.kilocodeToken = token ?? "anonymous"
            if (org) options.kilocodeOrganizationId = org
            if (!provider.enabled) provider.enabled = { via: "custom", data: { anonymous: true } }
            // kilocode_change end
          })
        }
      }),
      // kilocode_change start
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID !== id) return
        evt.sdk = createKilo(evt.options)
      }),
      // kilocode_change end
    }
  }),
})
