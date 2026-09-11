import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { providerMetadata } from "@/kilocode/provider/metadata"
import { overlay as overlayAnacondaDesktop } from "@/kilocode/anaconda-desktop/provider"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"

export const disabledProvidersHandlers = HttpApiBuilder.group(InstanceHttpApi, "disabled-providers", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service

    const list = Effect.fn("DisabledProvidersHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = overlayAnacondaDesktop(yield* ModelsDev.Service.use((s) => s.get()))
      const disabled = new Set(config.disabled_providers ?? [])
      return Object.entries(all)
        .filter(([id]) => disabled.has(id))
        .map(([, item]) => {
          const info = Provider.toPublicInfo(Provider.fromModelsDevProvider(item))
          return { ...info, metadata: providerMetadata(info.id) }
        })
    })

    return handlers.handle("list", list)
  }),
)
