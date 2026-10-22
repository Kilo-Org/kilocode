export * as KiloGatewayErrors from "./gateway-errors"

import { KiloErrors } from "@kilocode/gateway-core"
import { AIError, AIErrorReason, CompactionCheckpointResponse, CompactionResponse, HttpContext } from "@opencode/ai"
import { LLMClient } from "@opencode/ai/route"
import type {
  CheckpointRequest,
  CompactionRequest,
  EndpointCompactOptions,
  Service,
  TriggerCompactOptions,
} from "@opencode/ai/route/client"
import { Effect, Layer, Stream } from "effect"

// The native provider classifier keeps the complete normalized frame, including Kilo's retry decision.
// Known Kilo terminal errors and top-up use the existing override across stream, generate, and compact.
export const layer = <E, R>(base: Layer.Layer<Service, E, R>) =>
  Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      function compact(
        request: CheckpointRequest,
        options: TriggerCompactOptions,
      ): Effect.Effect<CompactionCheckpointResponse, AIError>
      function compact(
        request: CompactionRequest,
        options?: EndpointCompactOptions,
      ): Effect.Effect<CompactionResponse, AIError>
      function compact(
        request: CheckpointRequest | CompactionRequest,
        options?: EndpointCompactOptions | TriggerCompactOptions,
      ) {
        // The overloads tie the request capability to the selected mechanism. Only the error is changed here.
        const result: Effect.Effect<CompactionCheckpointResponse | CompactionResponse, AIError> =
          options?.mechanism === "trigger"
            ? client.compact(request as CheckpointRequest, options)
            : client.compact(request as CompactionRequest, options)
        return request.model.provider === "kilo" ? result.pipe(Effect.mapError(normalize)) : result
      }
      return LLMClient.Service.of({
        ...client,
        compact,
        stream: (request, options) =>
          request.model.provider !== "kilo"
            ? client.stream(request, options)
            : client.stream(request, options).pipe(Stream.mapError(normalize)),
        generate: (request, options) =>
          request.model.provider !== "kilo"
            ? client.generate(request, options)
            : client.generate(request, options).pipe(Effect.mapError(normalize)),
      })
    }),
  ).pipe(Layer.provide(base))

function normalize(error: AIError): AIError {
  const http = error.reason.http
  if (!http || !error.reason.body) return error
  const parsed = KiloErrors.parse(error.reason.body, http.status >= 400 ? http.status : undefined)
  if (
    !parsed ||
    (parsed.retryable !== false && parsed.code !== KiloErrors.CODES.TOP_UP_IN_PROGRESS) ||
    (http.headers["x-should-retry"] !== undefined && parsed.retryable !== false)
  )
    return error
  // Known terminal Kilo errors win over a positive hint, as they do in the HTTP normalizer.
  return new AIError({
    reason: AIErrorReason.make({
      ...error.reason,
      message: error.reason.message,
      cause: error.reason.cause,
      http: new HttpContext({ ...http, headers: { ...http.headers, "x-should-retry": String(parsed.retryable) } }),
    }),
  })
}
