export * as Voice from "./voice.js"

import { type AIError } from "@opencode/ai"
import {
  Realtime,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
  type RealtimeTransportType,
} from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"

export interface ModelInfo {
  readonly model: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
  /** The integration whose connection starts its sessions: the provider's for a stored key, or a host's. */
  readonly integration?: string
  /** The workspace its sessions bill to, for display: set only when a host that names one runs it. */
  readonly workspace?: string
}

export interface Models {
  readonly models: readonly ModelInfo[]
  readonly default?: string
}

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export interface Session {
  readonly transport: RealtimeTransport
  /** A hosted session's ID, which `instruct` names it by. */
  readonly id?: string
}

export interface InstructInput {
  readonly id: string
  readonly instructions: string
}

/**
 * An integration that runs sessions for some models on its own account instead of a stored provider key, such as
 * the OpenCode Console's hosted GPT-Live. Its sessions' backend instructions change through it.
 */
export interface Host {
  readonly integration: string
  readonly models: readonly string[]
  /** The workspace its sessions bill to, for display. */
  readonly workspace?: string
  readonly session: (input: SessionInput) => Effect.Effect<Session, Error>
  readonly instruct: (input: InstructInput) => Effect.Effect<void, Error>
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
  readonly models: () => Effect.Effect<Models>
  readonly session: (input: SessionInput) => Effect.Effect<Session, Error>
  /** Replaces the backend instructions of a running session the host started. */
  readonly instruct: (input: InstructInput) => Effect.Effect<void, Error>
  /** Sets the host whose models start on it instead of a stored key, or removes it. */
  readonly host: (host: Host | undefined) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service
    let hosted: Host | undefined

    // Integration lists the active credential first, then newer stored credentials, then non-empty env vars.
    const findConnection = (provider: string) =>
      integrations
        .get(Integration.ID.make(provider))
        .pipe(Effect.map((info) => info?.connections.find((item) => item.type === "env" || item.method === "key")))

    const models = Effect.fn("Voice.models")(function* () {
      const host = hosted
      const list = yield* Effect.forEach(Realtime.engines, (engine): Effect.Effect<ModelInfo> =>
        host?.models.includes(engine.model)
          ? Effect.succeed({
              model: engine.model,
              provider: engine.provider,
              transports: engine.transports,
              available: true,
              integration: host.integration,
              ...(host.workspace === undefined ? {} : { workspace: host.workspace }),
            })
          : findConnection(engine.provider).pipe(
              Effect.map((connection) => ({
                model: engine.model,
                provider: engine.provider,
                transports: engine.transports,
                available: Boolean(connection),
                ...(connection ? { integration: engine.provider } : {}),
              })),
            ),
      )
      const first = list.find((item) => item.available)?.model
      return first ? { models: list, default: first } : { models: list }
    })

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const engine = Realtime.engine(input.model)
      if (!engine) return yield* new InvalidRequestError({ message: `Unsupported voice model: ${input.model}` })
      // A host offers a model on purpose, so it runs the model's sessions even where a stored key could.
      if (hosted?.models.includes(input.model)) return yield* hosted.session(input)

      const connection = yield* findConnection(engine.provider)
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

      const transport = yield* Realtime.connect({ ...input, apiKey: Redacted.make(credential.key) }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: engine.provider }),
        ),
      )
      return { transport }
    })

    const instruct = Effect.fn("Voice.instruct")(function* (input: InstructInput) {
      if (!hosted) return yield* new InvalidRequestError({ message: "Only hosted voice sessions take instructions" })
      return yield* hosted.instruct(input)
    })

    return Service.of({
      models,
      session,
      instruct,
      host: (host) =>
        Effect.sync(() => {
          hosted = host
        }),
    })
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
