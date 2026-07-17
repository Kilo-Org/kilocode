import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Deferred, Effect, Layer, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { Git } from "@/git"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { Vcs } from "@/project/vcs"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(
  Vcs.layer.pipe(Layer.provideMerge(Git.defaultLayer), Layer.provideMerge(EventV2Bridge.defaultLayer)),
  CrossSpawnSpawner.defaultLayer,
  FSUtil.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer)),
)
const it = testEffect(layer)

const git = Effect.fn("WatcherBootstrapTest.git")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
})

const next = Effect.fn("WatcherBootstrapTest.next")(function* (branch: string) {
  const events = yield* EventV2Bridge.Service
  const pending = yield* Deferred.make<string | undefined>()
  const off = yield* events.listen((event) => {
    if (event.type !== Vcs.Event.BranchUpdated.type) return Effect.void
    const data = Schema.decodeUnknownSync(Vcs.Event.BranchUpdated.data)(event.data)
    if (data.branch === branch) Deferred.doneUnsafe(pending, Effect.succeed(data.branch))
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)
  return pending
})

it.live(
  "publishes a branch update when the CLI instance changes HEAD",
  () =>
    Effect.gen(function* () {
      expect(Watcher.hasNativeBinding()).toBe(true)
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* Effect.acquireRelease(store.load({ directory: dir }), store.dispose)

      yield* Effect.gen(function* () {
        const branch = `watch-${Math.random().toString(36).slice(2)}`
        yield* git(dir, ["branch", branch])

        const vcs = yield* Vcs.Service
        yield* vcs.init()
        const initial = yield* vcs.branch()
        expect(initial).toBeDefined()
        const pending = yield* next(branch)

        for (let attempt = 0; attempt < 20 && !(yield* Deferred.isDone(pending)); attempt++) {
          yield* git(dir, ["switch", branch])
          yield* Effect.sleep("50 millis")
          if (yield* Deferred.isDone(pending)) break
          if (initial) yield* git(dir, ["switch", initial])
          yield* Effect.sleep("50 millis")
        }

        const updated = yield* Deferred.await(pending).pipe(Effect.timeout("5 seconds"))
        expect(updated).toBe(branch)
      }).pipe(Effect.provideService(InstanceRef, ctx))
    }),
  30_000,
)
