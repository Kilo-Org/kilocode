import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { Config } from "../../../src/config/config"
import type { ConfigPlugin } from "../../../src/config/plugin"
import { KilocodeDefaultPlugins } from "../../../src/kilocode/config/default-plugins"
import { INDEXING_PLUGIN } from "../../../src/kilocode/indexing-feature"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Env } from "../../../src/env"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Filesystem } from "../../../src/util/filesystem"
import { WithInstance } from "../../../src/project/with-instance"
import { Npm } from "@opencode-ai/core/npm"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

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
describe("kilocode default indexing plugin", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  test("injects indexing without registering an external plugin origin", () => {
    const config: { plugin?: ConfigPlugin.Spec[]; plugin_origins?: ConfigPlugin.Origin[] } = {}

    KilocodeDefaultPlugins.apply(config, { disabled: false })

    expect(hasIndexingPlugin(config.plugin ?? [])).toBe(true)
    expect(config.plugin_origins).toBeUndefined()
  })

  test("removes a persisted indexing marker from external plugin origins", () => {
    const external: ConfigPlugin.Origin = { spec: "global-plugin", source: "global", scope: "global" }
    const config = {
      plugin: [INDEXING_PLUGIN, external.spec],
      plugin_origins: [{ spec: INDEXING_PLUGIN, source: "global", scope: "global" as const }, external],
    }

    KilocodeDefaultPlugins.apply(config, { disabled: true })

    expect(config.plugin).toEqual([INDEXING_PLUGIN, external.spec])
    expect(config.plugin_origins).toEqual([external])
  })

  test("does not hard-enable indexing plugin when default plugins are disabled", async () => {
    const original = Flag.KILO_DISABLE_DEFAULT_PLUGINS
    Flag.KILO_DISABLE_DEFAULT_PLUGINS = true

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

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
          const config = await load()
          expect(hasIndexingPlugin(config.plugin ?? [])).toBe(false)
        },
      })
    } finally {
      Flag.KILO_DISABLE_DEFAULT_PLUGINS = original
    }
  })
})
