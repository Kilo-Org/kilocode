import { Effect } from "effect"
import { define } from "../internal"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider" // kilocode_change

export const LLMGatewayPlugin = define({
  id: "llmgateway",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.disabled) continue
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.api.url !== "https://api.llmgateway.io/v1") continue
          if (item.provider.id !== ProviderV2.ID.make("llmgateway")) continue // kilocode_change
          if (!(yield* integrations.get(Integration.ID.make(item.provider.id)))) continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://kilo.ai/"
            // kilocode_change start
            provider.request.headers["X-Title"] = "Kilo Code"
            provider.request.headers["X-Source"] = "kilo"
            // kilocode_change end
          })
        }
      }),
    )
  }),
})
