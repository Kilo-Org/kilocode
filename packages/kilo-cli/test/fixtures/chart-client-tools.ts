import "../../src/env"
import { AbsolutePath } from "@opencode/core/schema"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Tool } from "@opencode/core/tool"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { toolDefinitions } from "../../../core/test/lib/tool"
import { KiloHost } from "../../src/host"

const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-chart-client-"))
try {
  const tools = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          createRoutes(
            {
              password: "secret",
              database: { path: ":memory:" },
              models: { fetch: false },
              fs: { filewatcher: false },
              config: { directory, project: false },
            },
            () => [],
            KiloHost.overrides,
          ).pipe(Layer.provide(HttpServer.layerServices)),
        )
        const locations = Context.get(context, LocationServiceMap.Service)
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const registry = yield* Tool.Service
          return (yield* toolDefinitions(registry)).map((tool) => tool.name)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))))
      }),
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
  )
  console.log(JSON.stringify({ app: (await import("../../src/app")).KiloApp.name, tools }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
