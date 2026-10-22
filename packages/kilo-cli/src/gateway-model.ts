export * as KiloGatewayModel from "./gateway-model"

import { Rpc } from "@opencode/core/rpc"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"

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
          // System failures and arbitrary RPC messages must not expose endpoints, credentials, or response bodies.
          onFailure: (error) =>
            "type" in error &&
            error.type === "failed" &&
            /^Failed to load the Kilo model catalog \((HTTP [1-5][0-9]{2}|network|schema)\)\. Check your connection and credentials\.$/.test(
              error.message,
            )
              ? error.message
              : undefined,
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
