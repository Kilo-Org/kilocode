import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import path from "path"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { Config } from "../../../src/config"
import * as CrossSpawnSpawner from "../../../src/effect/cross-spawn-spawner"
import { Env } from "../../../src/env"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { Filesystem } from "../../../src/util"
import { Instance } from "../../../src/project/instance"
import { Npm } from "../../../src/npm"
import { tmpdir } from "../../fixture/fixture"

const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)
const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})
const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})
const noopNpm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
  add: () => Effect.die("not implemented"),
  outdated: () => Effect.succeed(false),
  which: () => Effect.succeed(Option.none()),
})
const layer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provideMerge(infra),
  Layer.provide(noopNpm),
)

const load = () => Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))
const clear = (wait = false) =>
  Effect.runPromise(Config.Service.use((svc) => svc.invalidate(wait)).pipe(Effect.scoped, Effect.provide(layer)))

describe("kilocode default indexing plugin", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await clear(true)
  })

  test("does not hard-enable indexing plugin when default plugins are disabled", async () => {
    const prev = process.env["KILO_DISABLE_DEFAULT_PLUGINS"]
    process.env["KILO_DISABLE_DEFAULT_PLUGINS"] = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Filesystem.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://app.kilo.ai/config.json",
              plugin: ["global-plugin-1"],
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await load()
          expect(hasIndexingPlugin(config.plugin ?? [])).toBe(false)
        },
      })
    } finally {
      if (prev === undefined) delete process.env["KILO_DISABLE_DEFAULT_PLUGINS"]
      else process.env["KILO_DISABLE_DEFAULT_PLUGINS"] = prev
    }
  })
})
