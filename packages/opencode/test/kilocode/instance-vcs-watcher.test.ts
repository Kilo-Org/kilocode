import { afterAll, beforeAll, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { Git } from "../../src/git"
import { InstanceLayer } from "../../src/project/instance-layer"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const layer = Layer.mergeAll(InstanceLayer.layer, Git.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(layer)

// The suite disables the file watcher (see test/preload.ts); this file tests it, so opt back in.
const disableFilewatcher = process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER
beforeAll(() => {
  delete process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER
})
afterAll(() => {
  if (disableFilewatcher !== undefined) process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER = disableFilewatcher
})

// The watcher is unreliable on Windows CI, so this test only runs on unix.
const live = process.platform === "win32" ? it.live.skip : it.live

live("instances publish branch updates after git switch", () =>
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
