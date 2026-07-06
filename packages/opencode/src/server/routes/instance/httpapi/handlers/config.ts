import { Config } from "@/config/config"
// kilocode_change start - preserve Kilo API default model overlay
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { Auth } from "@/auth"
import { ModelID, ProviderID } from "@/provider/schema"
import { filterPromptTrainingModels, nonEmptyProviders } from "@/kilocode/provider/model-filter"
// kilocode_change end
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi" // kilocode_change
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

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
      // kilocode_change start
      const config = yield* configSvc.get()
      const providers = filterPromptTrainingModels(
        yield* providerSvc.list(),
        config.hide_prompt_training_models === true,
      )
      const defaults = Provider.defaultModelIDs(nonEmptyProviders(providers))
      // kilocode_change end

      // kilocode_change start - Fetch default model from Kilo API when the kilo provider is available.
      if (providers[ProviderID.kilo]) {
        const auth = yield* Auth.Service
        const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({}))) // kilocode_change
        const token = info?.type === "oauth" ? info.access : info?.key
        const organizationId = info?.type === "oauth" ? info.accountId : undefined
        const model = yield* Effect.promise(() => fetchDefaultModel(token, organizationId))
        if (model && providers[ProviderID.kilo]?.models[model]) defaults[ProviderID.kilo] = ModelID.make(model)
      }
      // kilocode_change end

      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: defaults,
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("warnings", warnings)
      .handle("providers", providers) // kilocode_change
  }),
)
