import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { tmpdirScoped } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

it.live(
  "one scheduler fires once when adoption overlaps a creator's completed store write",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
      const storageLayer = Storage.layerFromDir(path.join(directory, "storage")).pipe(
        Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
      )
      const storage = Context.get(yield* Layer.buildWithScope(storageLayer, scope), Storage.Service)
      const written = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const state = { paused: false }
      const fired: Wakeup.Info[] = []
      const intercepted = Storage.Service.of({
        ...storage,
        write: (key, content) =>
          Effect.gen(function* () {
            yield* storage.write(key, content)
            if (key[0] !== "cron" || state.paused) return
            state.paused = true
            yield* Deferred.succeed(written, undefined)
            // The write has completed, but cronCreate has not cached or armed it.
            yield* Deferred.await(release)
          }),
      })
      const layer = Layer.fresh(
        Wakeup.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Storage.Service, intercepted),
              Layer.mock(EventV2Bridge.Service, {
                publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
              }),
              Layer.succeed(
                Wakeup.Fire,
                Wakeup.Fire.of({ run: (info) => Effect.sync(() => fired.push(info)).pipe(Effect.asVoid) }),
              ),
            ),
          ),
        ),
      )
      const service = Context.get(yield* Layer.buildWithScope(layer, scope), Wakeup.Service)
      const creation = yield* Effect.forkIn(
        service.cronCreate({
          sessionID: SessionID.descending(),
          directory,
          prompt: "single scheduler adoption race",
          when: new Date(Date.now() + 1500).toISOString(),
        }),
        scope,
      )
      yield* Deferred.await(written)
      yield* service.adopt(directory)
      // Let the adopted occurrence become due before the creator returns from
      // its write. Its later arm must not dispatch that same occurrence again.
      yield* Effect.sleep("1700 millis")
      yield* Deferred.succeed(release, undefined)
      const task = yield* Fiber.join(creation)
      yield* pollWithTimeout(
        Effect.sync(() => (fired.length ? fired : undefined)),
        "the adopted task did not fire",
        "5 seconds",
      )
      yield* Effect.sleep("1 second")
      expect(fired.map((info) => info.id)).toEqual([task.id])
    }),
  15000,
)
