// kilocode_change - new file
import { createKilo, KILO_OPENROUTER_BASE } from "@kilocode/kilo-gateway"
import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

const id = ProviderV2.ID.make("kilo")

export const KiloPlugin = PluginV2.define({
  id: PluginV2.ID.make("kilo"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== id) return

        const options = evt.provider.options.aisdk.provider
        const token = options.kilocodeToken ?? options.apiKey ?? process.env.KILO_API_KEY
        const org = process.env.KILO_ORG_ID ?? options.kilocodeOrganizationId

        evt.provider.endpoint = {
          type: "aisdk",
          package: "@kilocode/kilo-gateway",
          url: KILO_OPENROUTER_BASE,
        }
        evt.provider.options.headers["HTTP-Referer"] = "https://kilo.ai/"
        evt.provider.options.headers["X-Title"] = "Kilo Code"
        options.kilocodeToken = token ?? "anonymous"
        if (org) options.kilocodeOrganizationId = org
        if (!evt.provider.enabled) evt.provider.enabled = { via: "custom", data: { anonymous: true } }
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID !== id) return
        evt.sdk = createKilo(evt.options)
      }),
    }
  }),
})
