import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { AttemptNotFoundError, ConflictError, InvalidRequestError } from "@opencode-ai/protocol/errors" // kilocode_change - an absent attempt is a 404 and a settling one a 409
import { response } from "../location"

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.oauth",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.oauth({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.attempt.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.attempt.status(ctx.params.attemptID))
        }),
      )
      .handle(
        "integration.attempt.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
            // kilocode_change start - an absent or collected attempt handle reports a 404, not a 400
            Effect.mapError((error) => {
              if (error._tag === "Integration.AttemptNotFound") {
                return new AttemptNotFoundError({
                  attemptID: ctx.params.attemptID,
                  message: "OAuth attempt not found",
                })
              }
              if (error._tag === "Integration.AttemptCompleting") {
                return new ConflictError({
                  message: "OAuth attempt is already completing",
                  resource: ctx.params.attemptID,
                })
              }
              return new InvalidRequestError({
                message:
                  error._tag === "Integration.CodeRequired"
                    ? "Authorization code is required"
                    : "Authentication failed",
                kind:
                  error._tag === "Integration.CodeRequired"
                    ? "integration_code_required"
                    : "integration_authorization",
              })
            }),
            // kilocode_change end
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.attempt.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
