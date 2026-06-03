import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"
// kilocode_change start
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { Auth } from "@/auth"
import { ModelID, ProviderID } from "@/provider/schema"
// kilocode_change end

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    // kilocode_change start
    const warnings = Effect.fn("ConfigHttpApi.warnings")(function* () {
      return yield* configSvc.warnings()
    })
    // kilocode_change end

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      const defaults = Provider.defaultModelIDs(providers)

      // kilocode_change start - Keep Kilo API default-model lookup aligned with the legacy Hono route.
      if (providers[ProviderID.kilo]) {
        const auth = yield* Auth.Service
        const kiloAuth = yield* auth.get("kilo").pipe(Effect.orDie)
        const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
        const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
        const kiloApiDefault = yield* Effect.promise(() => fetchDefaultModel(token, organizationId))
        if (kiloApiDefault && providers[ProviderID.kilo]?.models[kiloApiDefault]) {
          defaults[ProviderID.kilo] = ModelID.make(kiloApiDefault)
        }
      }
      // kilocode_change end

      return {
        providers: Object.values(providers),
        default: defaults, // kilocode_change
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("warnings", warnings)
      .handle("providers", providers) // kilocode_change
  }),
)
