import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Context, Effect } from "effect"

// The server stopped waiting for a Location's plugins in rpc.call (upstream v2.2.7, "stop waiting for plugins in
// request handlers"). A one-shot test caller that boots routes and immediately calls a Kilo RPC must wait for the
// Location's plugins to finish registering, the same way packages/server/test/fixture/routes.ts does.
export const loadPlugins = (context: Context.Context<LocationServiceMap.Service>, directory: string) =>
  Plugin.awaitActivation.pipe(
    Effect.provide(
      Context.get(context, LocationServiceMap.Service).get(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
    ),
  )
