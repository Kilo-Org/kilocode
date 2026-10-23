import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Voice } from "@opencode/core/voice"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, locationErrors } from "../location"

const voiceErrors = (error: Voice.Error) =>
  error._tag === "Voice.InvalidRequestError"
    ? new InvalidRequestError({ message: error.message })
    : new ServiceUnavailableError({ message: error.message, service: error.service })

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers
      .handle(
        "voice.models",
        Effect.fn("server.voice.models")(
          function* () {
            yield* awaitPlugins
            const voice = yield* Voice.Service
            return { data: yield* voice.models() }
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
      .handle(
        "voice.session",
        Effect.fn("server.voice.session")(
          function* (request) {
            yield* awaitPlugins
            const voice = yield* Voice.Service
            const session = yield* voice.session(request.payload).pipe(Effect.mapError(voiceErrors))
            return {
              data: { transport: session.transport, ...(session.id === undefined ? {} : { session: { id: session.id } }) },
            }
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
      .handle(
        "voice.instructions",
        Effect.fn("server.voice.instructions")(
          function* (request) {
            yield* awaitPlugins
            const voice = yield* Voice.Service
            yield* voice
              .instruct({ id: request.params.sessionID, instructions: request.payload.instructions })
              .pipe(Effect.mapError(voiceErrors))
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
  }),
)
