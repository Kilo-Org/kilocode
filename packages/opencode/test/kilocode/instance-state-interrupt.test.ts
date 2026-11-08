import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LayerNode.compile(CrossSpawnSpawner.node), testInstanceStoreLayer))

const access = <A, E>(state: InstanceState.InstanceState<A, E>, dir: string) =>
  InstanceState.get(state).pipe(provideInstanceEffect(dir))

it.live("InstanceState retries a lookup whose caller was interrupted", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const started = yield* Deferred.make<void>()
    const released: number[] = []
    let n = 0
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const id = ++n
        yield* Effect.addFinalizer(() => Effect.sync(() => released.push(id)))
        if (id === 1) {
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        }
        return id
      }),
    )

    // A client that disconnects mid-lookup interrupts the request fiber running it.
    const fiber = yield* access(state, dir).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)

    // The next caller gets a fresh value instead of the cached interruption, and the
    // abandoned lookup's resources are released.
    expect(yield* access(state, dir)).toBe(2)
    expect(released).toEqual([1])
  }),
)

it.live("InstanceState still caches a lookup that failed", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    let n = 0
    const state = yield* InstanceState.make(() => Effect.suspend(() => Effect.fail(++n)))

    const a = yield* access(state, dir).pipe(Effect.flip)
    const b = yield* access(state, dir).pipe(Effect.flip)

    expect(a).toBe(1)
    expect(b).toBe(1)
  }),
)
