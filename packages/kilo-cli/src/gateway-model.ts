export * as KiloGatewayModel from "./gateway-model"

import { KiloCredential, KiloErrors, KiloServer } from "@kilocode/gateway-core"
import { LanguageModel } from "@opencode/ai/effect"
import { Auth } from "@opencode/ai/route"
import { Integration } from "@opencode/core/integration"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Model } from "@opencode/schema/model"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { KiloGatewayImage } from "./gateway-image"

// v1 preserves an explicitly empty Kilo credential instead of falling through to another account.
// Keep native validation unchanged elsewhere; the Kilo HTTP boundary still owns final request headers.
const emptyCredentialsLayer = Layer.effect(
    ModelResolver.Service,
    Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      const emptyAuth = (resolved: ModelResolver.Resolved) => Effect.gen(function* () {
        if (resolved.ref.providerID !== "kilo") return resolved
        const provider = yield* providers.get(resolved.ref.providerID)
        const route = resolved.model.route
        // The marker selects the empty-credential auth below; it must never reach the Gateway body. The model copies
        // the route options when it is built, so remove the marker from both.
        for (const options of [route.options?.providerOptions, resolved.model.options?.providerOptions])
          if (options !== undefined && "kiloEmptyToken" in options)
            delete (options as Record<string, unknown>).kiloEmptyToken
        if (provider?.settings?.kiloEmptyToken !== true) return resolved
        return {
          ...resolved,
          model: LanguageModel.update(resolved.model, {
            route: route.with({ auth: Auth.headers({ authorization: "Bearer" }) }),
          }),
        }
      })
      const emptyToken = (ref: Model.Ref) =>
        ref.providerID !== "kilo"
          ? Effect.succeed(false)
          : providers.get(ref.providerID).pipe(Effect.map((provider) => provider?.settings?.kiloEmptyToken === true))
      // The Gateway serves its image models on the chat completions route, which no provider package speaks, so Kilo
      // image models are built here from the provider settings the Gateway plugin installed.
      const gatewayImage = (ref: Model.Ref) =>
        Effect.gen(function* () {
          const record = (yield* providers.snapshot()).records.get(ref.providerID)
          const info = record?.models.get(ref.id)
          if (!record || !info || info.type !== "image") return undefined
          const settings = Provider.mergeOverlay(record.provider.settings, Provider.modelSettings(info.settings))
          // The signed-in token lives in the credential store, not in the provider settings the plugin installs.
          const connection = yield* integrations.connection.active(
            record.provider.integrationID ?? Integration.ID.make(ref.providerID),
          )
          const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
          const token = credential ? KiloCredential.token(credential) : undefined
          return KiloGatewayImage.model({
            id: ref.id,
            baseURL: typeof settings?.baseURL === "string" ? settings.baseURL : KiloServer.aiGatewayFromEnv(),
            apiKey: token ?? (typeof settings?.apiKey === "string" ? settings.apiKey : undefined),
            headers: info.headers,
          })
        })
      return ModelResolver.Service.of({
        resolve: (requested) => resolver.resolve(requested).pipe(
          Effect.flatMap((resolved) => resolved ? emptyAuth(resolved) : Effect.undefined),
        ),
        resolveModel: (model, variant) => resolver.resolveModel(model, variant).pipe(Effect.flatMap(emptyAuth)),
        // Media routes have no auth override like `route.with` above. With an explicitly empty Kilo credential, a
        // Kilo image or decision model would fall back to a stale lower-priority key, so it fails closed instead.
        resolveImage: (ref) =>
          emptyToken(ref).pipe(
            Effect.flatMap((empty) => {
              if (empty) return Effect.undefined
              if (ref.providerID !== "kilo") return resolver.resolveImage(ref)
              return gatewayImage(ref)
            }),
          ),
        resolveDecision: (ref) =>
          emptyToken(ref).pipe(Effect.flatMap((empty) => (empty ? Effect.undefined : resolver.resolveDecision(ref)))),
      })
    }),
  )

export const resolverLayer = <E, R>(base: Layer.Layer<ModelResolver.Service, E, R>) =>
  emptyCredentialsLayer.pipe(Layer.provide(base))

const resolverBase = ModelResolver.node.mapLayer((layer) => layer)
export const resolverNode = makeLocationNode({
  service: ModelResolver.Service,
  layer: emptyCredentialsLayer,
  deps: [resolverBase, Provider.node, Integration.node],
})

class CatalogModelNotSelectedError extends SessionRunnerModel.ModelNotSelectedError {
  constructor(
    input: ConstructorParameters<typeof SessionRunnerModel.ModelNotSelectedError>[0],
    readonly detail: string,
  ) {
    super(input)
  }

  override get message() {
    return this.detail
  }
}

class CatalogModelUnavailableError extends SessionRunnerModel.ModelUnavailableError {
  constructor(
    input: ConstructorParameters<typeof SessionRunnerModel.ModelUnavailableError>[0],
    readonly detail: string,
  ) {
    super(input)
  }

  override get message() {
    return this.detail
  }
}

// A distinct base node retains upstream resolution and its wiring without replacing itself recursively.
const base = SessionRunnerModel.node.mapLayer((layer) => layer)
const layer = Layer.effect(
  SessionRunnerModel.Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunnerModel.Service
    const rpc = yield* Rpc.Service
    const diagnostic = rpc
      .client(KiloGatewayRpc.Definition)
      .models({})
      .pipe(
        Effect.match({
          onSuccess: () => undefined,
          // Format validated failure data, never a free-form RPC message that can contain private details.
          onFailure: (error) =>
            "type" in error && error.type === "failed" ? KiloErrors.catalogMessage(error.data) : undefined,
        }),
      )
    return SessionRunnerModel.Service.of({
      resolve: (session, available) =>
        runner.resolve(session, available).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              if (
                !(error instanceof SessionRunnerModel.ModelNotSelectedError) &&
                !(error instanceof SessionRunnerModel.ModelUnavailableError && error.providerID === "kilo")
              )
                return yield* error
              const detail = yield* diagnostic
              if (!detail) return yield* error
              return yield* error instanceof SessionRunnerModel.ModelNotSelectedError
                ? new CatalogModelNotSelectedError({ sessionID: error.sessionID }, detail)
                : new CatalogModelUnavailableError({ providerID: error.providerID, modelID: error.modelID }, detail)
            }),
          ),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: SessionRunnerModel.Service,
  layer,
  deps: [base, Rpc.node],
})
