// kilocode_change - new file
//
// Kilo uses Npm.Service (arborist) for dependency installation and may write
// a .gitignore inside the .kilo config dir. Users may have pnpm or yarn as
// their system package manager, which can produce lockfiles in the .kilo/
// config directory. These must be ignored so they don't appear as untracked
// files in the user's project.

import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Config } from "../../src/config"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { Npm } from "@opencode-ai/shared/npm"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Env } from "../../src/env"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
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
  outdated: () => Effect.succeed(false),
  which: () => Effect.succeed(Option.none()),
})

const testLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provideMerge(infra),
  Layer.provide(noopNpm),
)

test(".gitignore in .kilo config dir includes pnpm and yarn lockfile patterns", async () => {
  await using tmp = await tmpdir()
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })

  await Instance.provide({
    directory: dir,
    fn: async () => {
      await Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(testLayer)))
    },
  })

  const ignore = await Filesystem.readText(path.join(kilo, ".gitignore"))
  expect(ignore).toContain("pnpm-lock.yaml")
  expect(ignore).toContain("yarn.lock")
})
