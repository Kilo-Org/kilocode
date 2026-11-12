import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { LocationNotFoundError, InvalidRequestError } from "@opencode/protocol/errors" // kilocode_change(location-boot)
import { Effect, Layer, RcMap, Schema } from "effect" // kilocode_change(location-boot)
import { HttpServerRequest, HttpServerResponse } from "effect/http" // kilocode_change(location-boot)
import { HttpApiMiddleware } from "effect/http-api"
import { missingSession } from "./handlers/session-error"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: [LocationNotFoundError] },
) {}

export function locationErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, FileSystem.DirectoryNotFoundError> =>
        error instanceof FileSystem.DirectoryNotFoundError,
      (error) =>
        Effect.fail(
          new LocationNotFoundError({
            location: { directory: error.directory },
            message: `Location not found: ${error.directory}`,
          }),
        ),
    ),
  )
}

// kilocode_change start - location-boot: wait for activation without a deadline
// Plugins of a cold Location can take longer than any fixed deadline while other Locations boot, and the
// catalog is complete a moment later. Failing the request turned that delay into an error for the client.
export const awaitPlugins = Plugin.awaitActivation
// kilocode_change end

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

const decodeSessionID = Schema.decodeUnknownEffect(Session.ID)

export const sessionInfo = Effect.fnUntraced(function* (sessions: Session.Interface, sessionID: unknown) {
  const id = yield* decodeSessionID(sessionID).pipe(
    Effect.mapError(() => new InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
  return yield* sessions.get(id).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
})

export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-opencode-directory"] ? decode(request.headers["x-opencode-directory"]) : process.cwd())
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
  })
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

// kilocode_change start - location-boot: endpoints that only read in-memory pending state
const PENDING_LISTS: ReadonlySet<string> = new Set(["permission.request.list", "form.list"])
// kilocode_change end

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    // kilocode_change start - location-boot: listing pending requests must not boot a Location
    // Pending permissions and forms live in memory, so a Location that isn't loaded has none (same rule as
    // session.form.list). Clients poll every worktree they show; each poll used to boot a whole Location.
    return LocationMiddleware.of((effect, options) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const ref = requestRef(request)
        if (
          PENDING_LISTS.has(options.endpoint.identifier) &&
          !(yield* RcMap.has(locations.rcMap, LocationServiceMap.canonical(ref)))
        )
          return HttpServerResponse.jsonUnsafe({ location: { directory: ref.directory }, data: [] })
        return yield* effect.pipe(Effect.provide(locations.get(ref)), locationErrors)
      }),
    )
    // kilocode_change end
  }),
)
