export * as KiloGatewayErrors from "./gateway-errors"

import { KiloErrors } from "@kilocode/gateway-core"
import { AIError, AIErrorReason, HttpContext } from "@opencode/ai"
import { LLMClient } from "@opencode/ai/route"
import type { Service } from "@opencode/ai/route/client"
import { Effect, Layer, Stream } from "effect"

// The native provider classifier keeps the complete normalized frame, including Kilo's retry decision.
// Carry it through the existing HTTP override so both streamed and buffered calls use the same policy.
export const layer = <E, R>(base: Layer.Layer<Service, E, R>) =>
  Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      return LLMClient.Service.of({
        ...client,
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
  if (!http || http.headers["x-should-retry"] !== undefined || !error.reason.body) return error
  const parsed = KiloErrors.parse(error.reason.body, http.status >= 400 ? http.status : undefined)
  if (!parsed) return error
  return new AIError({
    reason: AIErrorReason.make({
      ...error.reason,
      message: error.reason.message,
      cause: error.reason.cause,
      http: new HttpContext({ ...http, headers: { ...http.headers, "x-should-retry": String(parsed.retryable) } }),
    }),
  })
}
