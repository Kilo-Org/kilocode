import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { discoverVariants } from "@/kilocode/provider/variant-discovery"
import { VariantDiscoveryBody } from "@/kilocode/server/httpapi/groups/provider"

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "variant-discovery", (handlers) =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service

    const discoverVariantsHandler = Effect.fn("ProviderHttpApi.discoverVariants")(function* (ctx: {
      payload: typeof VariantDiscoveryBody.Type
    }) {
      const catalog = yield* modelsDev.get()
      return discoverVariants(ctx.payload, catalog)
    })

    return handlers.handle("discoverVariants", discoverVariantsHandler)
  }),
)
