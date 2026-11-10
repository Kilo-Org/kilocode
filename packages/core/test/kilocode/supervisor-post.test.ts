import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { advance } from "../lib/clock"
import { testEffect } from "../lib/effect"

// Every supervisor activation scans the config plugin operations once, so counting scans counts activations.
let activations = 0
const sourceLayer = Layer.succeed(
  ConfigPluginSource.Service,
  ConfigPluginSource.Service.of({
    operations: () => Effect.sync(() => (activations++, [])),
    changes: () => Stream.never,
  }),
)

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) => Instance.layer(ref, { discovery: false, replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(sourceLayer),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, { provide: (session) => Effect.provide(map.get(session.location)) }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

describe("PluginSupervisor post-phase host plugins", () => {
  it.effect("activates a post-phase host plugin once across reloads", () =>
    Effect.gen(function* () {
      activations = 0
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(define({ id: "kilo-post", effect: () => Effect.void }), { phase: "post" })
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const inventory = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        // A new host plugin reloads the generation; each reload must rebuild the post list, not extend it.
        yield* sdk.register(define({ id: "kilo-reload", effect: () => Effect.void }))
        yield* advance(() => activations >= 2)
        yield* plugins.awaitActivation
        return yield* plugins.list()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(inventory.filter((plugin) => plugin.id === "kilo-post")).toEqual([
        { id: Plugin.ID.make("kilo-post"), source: { type: "sdk" }, state: { status: "active" }, features: { server: true } },
      ])
    }),
  )
})
