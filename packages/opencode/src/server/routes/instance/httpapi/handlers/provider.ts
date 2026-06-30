import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { mapValues, pickBy } from "remeda" // kilocode_change
import { ModelCache } from "@/provider/model-cache" // kilocode_change
import { disposeAllInstancesAfterProviderAuthCallback } from "@/kilocode/server/provider-auth-lifecycle" // kilocode_change
import { providerMetadata } from "@/kilocode/provider/metadata" // kilocode_change
import { filterPromptTrainingModels } from "@/kilocode/provider/model-filter" // kilocode_change
import { overlay as overlayAnacondaDesktop } from "@/kilocode/anaconda-desktop/provider" // kilocode_change
import { overlay as overlayTencent } from "@/kilocode/tencent/provider" // kilocode_change
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const cache = yield* ModelCache.Service // kilocode_change

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = overlayTencent(overlayAnacondaDesktop(yield* ModelsDev.Service.use((s) => s.get()))) // kilocode_change
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      // kilocode_change start
      const providers = filterPromptTrainingModels(
        Object.assign(
          mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
          connected,
        ),
        config.hide_prompt_training_models === true,
      )
      // kilocode_change end
      // kilocode_change start
      const failed = yield* cache.failedProviders()
      // Note: connected only contains providers with non-empty models after Provider.Service.list(),
      // so failed must be checked explicitly for providers whose fetch returned an error.
      const failedSet = new Set(failed)
      const validProviders = pickBy(
        providers,
        (item, id) => Object.keys(item.models).length > 0 || id in connected || failedSet.has(id),
      )
      return {
        all: Object.values(validProviders).map((item) => ({
          ...Provider.toPublicInfo(item),
          metadata: providerMetadata(item.id),
        })), // kilocode_change
        default: Provider.defaultModelIDs(pickBy(validProviders, (item) => Object.keys(item.models).length > 0)),
        connected: Object.keys(connected),
        failed,
      }
      // kilocode_change end
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      yield* disposeAllInstancesAfterProviderAuthCallback() // kilocode_change
      return true
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
