export * as Voice from "./voice.js"

import { type AIError } from "@opencode/ai"
import {
  Realtime,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
} from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Voice.InvalidRequestError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = InvalidRequestError | UnavailableError

export interface Interface {
  readonly session: (input: SessionInput) => Effect.Effect<RealtimeTransport, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const engine = Realtime.engine(input.model)
      if (!engine) return yield* new InvalidRequestError({ message: `Unsupported voice model: ${input.model}` })

      // Integration lists the active credential first, then newer stored credentials, then its env vars.
      const connection = (yield* integrations.get(Integration.ID.make(engine.provider)))?.connections.find(
        (item) => item.type === "env" || item.method === "key",
      )
      const credential = connection
        ? yield* integrations.connection
            .resolve(connection)
            .pipe(
              Effect.mapError((error) => new UnavailableError({ service: engine.provider, message: error.message })),
            )
        : undefined
      if (credential?.type !== "key")
        return yield* new UnavailableError({
          service: engine.provider,
          message: missingKeyMessage[engine.provider],
        })

      return yield* Realtime.connect({ ...input, apiKey: Redacted.make(credential.key) }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: engine.provider }),
        ),
      )
    })

    return Service.of({ session })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, requestExecutor],
})

const missingKeyMessage = {
  openai:
    "Voice needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions.",
  xai: "Voice needs an xAI API key on the server (a stored key or XAI_API_KEY).",
  google:
    "Voice needs a Google API key on the server (a stored key, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY).",
} as const
