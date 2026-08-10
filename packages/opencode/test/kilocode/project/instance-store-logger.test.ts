import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Logger } from "effect"
import { InstanceBootstrap } from "../../../src/project/bootstrap-service"
import { InstanceStore } from "../../../src/project/instance-store"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

let run: Effect.Effect<void> = Effect.void
const bootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.suspend(() => run) }),
)
const logger = Logger.make(() => {})
const layer = LayerNode.compile(LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]), [
  [InstanceStore.bootstrapNode, bootstrap],
]).pipe(Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false })))
const it = testEffect(layer)

it.live("preserves the active logger during instance bootstrap", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const store = yield* InstanceStore.Service
    const outer = yield* Effect.service(Logger.CurrentLoggers)
    let inner: ReadonlySet<Logger.Logger<unknown, unknown>> | undefined

    run = Effect.gen(function* () {
      inner = yield* Effect.service(Logger.CurrentLoggers)
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        run = Effect.void
      }),
    )

    yield* store.load({ directory: dir })

    expect(inner).toEqual(outer)
  }),
)
