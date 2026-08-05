import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors" // kilocode_change

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: InvalidRequestError }, // kilocode_change - surface malformed headers as 400s
) {}

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

function ref(request: HttpServerRequest.HttpServerRequest) {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-kilo-workspace"]
  const header = request.headers["x-kilo-directory"]
  // kilocode_change start - reject malformed encoded directory headers as client errors
  return Effect.try({
    try: () => query.get("location[directory]") || (header ? decodeURIComponent(header) : process.cwd()),
    catch: () => new InvalidRequestError({ message: "Invalid encoded directory header", field: "x-kilo-directory" }),
  }).pipe(
    Effect.map((directory) =>
      Location.Ref.make({
        directory: AbsolutePath.make(directory),
        workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
      }),
    ),
  )
  // kilocode_change end
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const location = yield* ref(request) // kilocode_change - reject malformed encoded directory headers as 400s
        return yield* effect.pipe(Effect.provide(locations.get(location)))
      }),
    )
  }),
)
