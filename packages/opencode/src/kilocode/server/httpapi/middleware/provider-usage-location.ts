import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "@/server/routes/instance/httpapi/middleware/workspace-routing"

export type ProviderUsageLocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class ProviderUsageLocationMiddleware extends HttpApiMiddleware.Service<
  ProviderUsageLocationMiddleware,
  {
    provides: ProviderUsageLocationServices
    requires: WorkspaceRouteContext
  }
>()("@kilocode/HttpApiProviderUsageLocation") {}

export const layer = Layer.effect(
  ProviderUsageLocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return ProviderUsageLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const directory = (() => {
          try {
            return decodeURIComponent(route.directory)
          } catch {
            return route.directory
          }
        })()
        const ref = Location.Ref.make({
          directory: AbsolutePath.make(directory),
          workspaceID: route.workspaceID,
        })
        return yield* effect.pipe(Effect.provide(locations.get(ref)))
      }),
    )
  }),
)
