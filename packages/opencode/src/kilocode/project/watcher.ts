import { InstanceState } from "@/effect/instance-state"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"

const watcher = (dir: string) => {
  const location = Location.layer({ directory: AbsolutePath.make(dir) }).pipe(Layer.provide(ProjectV2.defaultLayer))
  return Watcher.locationLayer.pipe(
    Layer.provide(location),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Global.defaultLayer),
  )
}

export const make = Effect.gen(function* () {
  const state = yield* InstanceState.make(
    Effect.fn("WatcherBootstrap.state")(function* (ctx) {
      yield* Watcher.Service.use(() => Effect.void).pipe(Effect.provide(watcher(ctx.directory)))
    }),
  )
  return InstanceState.get(state).pipe(Effect.asVoid)
})

export * as WatcherBootstrap from "./watcher"
