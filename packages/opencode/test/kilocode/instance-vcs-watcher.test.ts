import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ConfigProvider, Context, Deferred, Effect, Fiber, Layer, LayerMap } from "effect"
import * as TestConsole from "effect/testing/TestConsole"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { InstanceRef } from "../../src/effect/instance-ref"
import { disposeInstance } from "../../src/effect/instance-registry"
import { Git } from "../../src/git"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { KilocodeWatcher } from "../../src/kilocode/watcher"
import type { InstanceContext } from "../../src/project/instance-context"
import { tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, type LocationServices } from "@opencode-ai/core/location-services"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(InstanceStore.node, [[InstanceStore.bootstrapNode, InstanceBootstrap.node]]),
  AppNodeBuilder.build(Git.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const config = ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: "false" }), {
  asPrimary: true,
})
const it = testEffect(layer.pipe(Layer.provideMerge(config)))

// The watcher is unreliable on Windows CI, so this test only runs on unix.
const live = process.platform === "win32" ? it.live.skip : it.live

describe("KilocodeWatcher.eager", () => {
  test("skips eager location watchers for VS Code", () => {
    expect(KilocodeWatcher.eager("vscode")).toBe(false)
  })

  test("skips eager location watchers for JetBrains", () => {
    expect(KilocodeWatcher.eager("jetbrains")).toBe(false)
  })

  test("keeps eager location watchers for the standalone CLI", () => {
    expect(KilocodeWatcher.eager("cli")).toBe(true)
    expect(KilocodeWatcher.eager(undefined)).toBe(true)
  })
})

live(
  "instances publish branch updates after git switch",
  () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const git = yield* Git.Service
      const store = yield* InstanceStore.Service
      const current = yield* git.branch(dir)
      if (!current) return yield* Effect.die("missing initial branch")

      const branch = `watch-${Math.random().toString(36).slice(2)}`
      const created = yield* git.run(["branch", branch], { cwd: dir })
      expect(created.exitCode).toBe(0)
      yield* store.load({ directory: dir })

      const pending = yield* Deferred.make<string | undefined>()
      const handler = (event: GlobalEvent) => {
        if (event.directory !== dir || event.payload.type !== "vcs.branch.updated") return
        if (event.payload.properties.branch !== branch) return
        Deferred.doneUnsafe(pending, Effect.succeed(event.payload.properties.branch))
      }
      GlobalBus.on("event", handler)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", handler)))

      // The watcher exposes no readiness signal (its .git subscription is forked
      // during instance warm-up), so keep generating HEAD churn in the background
      // and synchronize on the event itself with the full test budget.
      const churn = yield* Effect.gen(function* () {
        while (true) {
          yield* git.run(["switch", current], { cwd: dir })
          yield* Effect.sleep("50 millis")
          yield* git.run(["switch", branch], { cwd: dir })
          yield* Effect.sleep("100 millis")
        }
      }).pipe(Effect.forkScoped)

      const updated = yield* awaitWithTimeout(
        Deferred.await(pending),
        "timed out waiting for vcs.branch.updated",
        "15 seconds",
      )
      yield* Fiber.interrupt(churn)
      expect(updated).toBe(branch)
    }),
  20_000,
)

test.serial(
  "isolates location lifetimes between instances",
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const one = yield* tmpdirScoped()
        const two = yield* tmpdirScoped()
        const warmed = new Map<string, number>()
        const invalidated: string[] = []
        const map = yield* LayerMap.make((ref: Location.Ref) =>
          Layer.effectContext(
            Effect.acquireRelease(
              Effect.sync(() => {
                warmed.set(ref.directory, (warmed.get(ref.directory) ?? 0) + 1)
                return Context.empty() as Context.Context<LocationServices>
              }),
              () => Effect.sync(() => invalidated.push(ref.directory)),
            ),
          ),
        )
        const watcher = KilocodeWatcher.layer.pipe(Layer.provide(Layer.succeed(LocationServiceMap.Service, map)))
        const services = yield* Layer.build(watcher)
        const init = (directory: string) =>
          KilocodeWatcher.Service.use((service) => service.init()).pipe(
            Effect.provide(services),
            Effect.provideService(InstanceRef, {
              directory,
              worktree: directory,
              project: { vcs: "git" },
            } as InstanceContext),
          )

        yield* init(one)
        yield* init(one)
        yield* init(two)
        yield* Effect.yieldNow
        expect(warmed).toEqual(
          new Map([
            [one, 1],
            [two, 1],
          ]),
        )
        yield* Effect.promise(() => disposeInstance(one))
        expect(invalidated).toEqual([one])
        yield* Effect.promise(() => disposeInstance(two))
        expect(invalidated).toEqual([one, two])
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestConsole.layer)),
      ),
    )
  },
  20_000,
)
