import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
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

      const fromCatalog = Object.entries(all)
        .filter(([id]) => disabled.has(id))
        .map(([, item]) => {
          const info = Provider.toPublicInfo(Provider.fromModelsDevProvider(item))
          return { ...info, metadata: providerMetadata(info.id) }
        })

      // Catalog (ModelsDev) only covers built-in providers. Custom providers
      // declared under config.provider can also be disabled via
      // disabled_providers — emit a stub Provider.Info so the settings UI can
      // re-enable them without the user hand-editing the config file.
      const fromCustom = Object.entries(config.provider ?? {})
        .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => {
          const [id, item] = entry
          return disabled.has(id) && item !== null && item !== undefined
        })
        .map(([id, item]) => {
          const info: Provider.Info = {
            id: ProviderV2.ID.make(id),
            name: item.name ?? id,
            source: "custom",
            env: [...(item.env ?? [])],
            options: {},
            models: {},
          }
          return { ...info, metadata: providerMetadata(id) }
        })

      return [...fromCatalog, ...fromCustom]
    })

    return handlers.handle("list", list)
  }),
)
