// kilocode_change - new file

import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Config } from "../../src/config/config"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Env } from "../../src/env"
import { Npm } from "@opencode-ai/core/npm"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { tmpdir } from "../fixture/fixture"

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
const save = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.update(config)).pipe(Effect.scoped, Effect.provide(layer)))

async function writeConfig(dir: string, config: unknown) {
  await Filesystem.write(path.join(dir, "kilo.json"), JSON.stringify(config, null, 2))
}

test("project config update creates .kilo/kilo.json and reloads it", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await save({ model: "updated/model" } as any)

      const written = await Filesystem.readJson<{ model: string }>(path.join(tmp.path, ".kilo", "kilo.json"))
      expect(written.model).toBe("updated/model")

      const loaded = await load()
      expect(loaded.model).toBe("updated/model")
    },
  })
})

test("project config update skips empty delete-only writes when no config exists", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await save({ provider: { missing: null } } as any)

      await expect(fs.access(path.join(tmp.path, ".kilo", "kilo.json"))).rejects.toThrow()
    },
  })
})

test("project config update prefers existing root kilo.json", async () => {
  await using tmp = await tmpdir()
  await writeConfig(tmp.path, { username: "alice" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await save({ model: "updated/model" } as any)

      const merged = await Filesystem.readJson<{ model: string; username: string }>(path.join(tmp.path, "kilo.json"))
      expect(merged.model).toBe("updated/model")
      expect(merged.username).toBe("alice")
    },
  })
})

test("project config update patches ancestor .kilo/kilo.json from nested directory", async () => {
  await using tmp = await tmpdir()
  const child = path.join(tmp.path, "nested", "workspace")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
  await writeConfig(path.join(tmp.path, ".kilo"), { username: "alice" })

  await Instance.provide({
    directory: child,
    fn: async () => {
      await save({ model: "updated/model" } as any)

      const merged = await Filesystem.readJson<{ model: string; username: string }>(
        path.join(tmp.path, ".kilo", "kilo.json"),
      )
      expect(merged.model).toBe("updated/model")
      expect(merged.username).toBe("alice")
      await expect(fs.access(path.join(child, ".kilo", "kilo.json"))).rejects.toThrow()
    },
  })
})
