import { expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Snapshot } from "../../src/snapshot"
import { requireInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Snapshot.defaultLayer, AppNodeBuilder.build(EffectFlock.node)))

for (const operation of ["track", "patch", "cleanup"] as const) {
  it.instance(
    `disabled snapshots bypass a held repository lock during ${operation}`,
    () =>
      Effect.gen(function* () {
        const ctx = yield* requireInstance
        const snapshot = yield* Snapshot.Service
        const flock = yield* EffectFlock.Service
        const gitdir = path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))
        yield* flock.acquire(`snapshot:${gitdir}`)

        const effect: Effect.Effect<unknown> =
          operation === "patch" ? snapshot.patch("existing-snapshot") : snapshot[operation]()
        const result = yield* awaitWithTimeout(
          effect,
          `${operation} waited for a snapshot lock while disabled`,
          "1 second",
        )

        expect(result).toEqual(operation === "patch" ? { hash: "existing-snapshot", files: [] } : undefined)
      }),
    { git: true, config: { snapshot: false } },
  )
}
