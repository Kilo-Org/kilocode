import path from "path"
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@/git"
import { Storage } from "@/storage/storage"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, CrossSpawnSpawner.node])))

it.live("keeps storage usable after the first caller is interrupted during initialization", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layer = Storage.layerFromDir(path.join(tmp, "storage")).pipe(
      Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
    )
    yield* Effect.gen(function* () {
      const storage = yield* Storage.Service
      // The first call starts the lazy migration check and suspends on file IO.
      const first = yield* storage.list(["wakeup"]).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Fiber.interrupt(first)
      yield* storage.write(["probe"], { ok: true })
      expect(yield* storage.read(["probe"])).toEqual({ ok: true })
    }).pipe(Effect.provide(layer))
  }),
)
