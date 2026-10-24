// kilocode_change - new file
// Verifies that Config.permission_origins attributes each permission key to the scope
// (global XDG vs local project) that last set it, which drives auto-approval provenance.

import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Config } from "../../../src/config/config"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Npm } from "@opencode-ai/core/npm"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "../../../src/permission"
import { Env } from "../../../src/env"
import { Git } from "../../../src/git"
import { Auth } from "../../../src/auth"
import { Account } from "../../../src/account/account"
import { provideTestInstance } from "../../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { HttpClient } from "effect/unstable/http"
import { tmpdir } from "../../fixture/fixture"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"

const infra = AppNodeBuilder.build(CrossSpawnSpawner.node).pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)
const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})
const emptyAuth = Layer.mock(Auth.Service)({ all: () => Effect.succeed({}) })
const noopNpm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
  add: () => Effect.die("not implemented"),
  which: () => Effect.succeed(undefined),
})
const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)
const testLayer = AppNodeBuilder.build(Config.node, [
  [Auth.node, emptyAuth],
  [Account.node, emptyAccount],
  [Npm.node, noopNpm],
  [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, unexpectedHttp)],
]).pipe(Layer.provideMerge(infra))

test("project config permission keys are attributed to the local scope", async () => {
  await using tmp = await tmpdir()
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })
  await Bun.write(path.join(kilo, "kilo.json"), JSON.stringify({ permission: { bash: { "echo *": "allow" } } }))

  await provideTestInstance({
    directory: dir,
    fn: async () => {
      const cfg = await Effect.runPromise(
        Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(testLayer)),
      )
      expect(cfg.permission?.bash).toEqual({ "echo *": "allow" })
      expect(cfg.permission_origins?.bash).toEqual({ "echo *": "local" })
    },
  })
})

test("a scalar project bash permission maps to the '*' pattern under the local scope", async () => {
  await using tmp = await tmpdir()
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })
  await Bun.write(path.join(kilo, "kilo.json"), JSON.stringify({ permission: { bash: "allow" } }))

  await provideTestInstance({
    directory: dir,
    fn: async () => {
      const cfg = await Effect.runPromise(
        Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(testLayer)),
      )
      expect(cfg.permission_origins?.bash).toEqual({ "*": "local" })
    },
  })
})

test("project permission entries apply after legacy ignore rules", async () => {
  await using tmp = await tmpdir()
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })
  await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/\n")
  await Bun.write(path.join(kilo, "kilo.json"), JSON.stringify({ permission: { read: { "*": "deny" } } }))

  await provideTestInstance({
    directory: dir,
    fn: async () => {
      const cfg = await Effect.runPromise(
        Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(testLayer)),
      )
      expect(cfg.permission?.read).toMatchObject({ "*": "deny" })
      expect(cfg.permission_origins?.read?.["*"]).toBe("local")
    },
  })
})

test("global permission entries decide a key and pattern that a project file also sets", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })
  await fs.mkdir(global, { recursive: true })
  await Bun.write(path.join(global, "kilo.json"), JSON.stringify({ permission: { bash: { "*": "ask" } } }))
  await Bun.write(
    path.join(kilo, "kilo.json"),
    JSON.stringify({ permission: { bash: { "*": "allow" }, edit: { "*": "deny" } } }),
  )

  const previous = Global.Path.config
  Global.Path.config = global
  try {
    await provideTestInstance({
      directory: dir,
      fn: async () => {
        const cfg = await Effect.runPromise(
          Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(testLayer)),
        )
        expect(cfg.permission?.bash).toEqual({ "*": "ask" })
        expect(cfg.permission?.edit).toEqual({ "*": "deny" })
        expect(cfg.permission_origins?.bash).toEqual({ "*": "global" })
        expect(cfg.permission_origins?.edit).toEqual({ "*": "local" })
        const rules = Permission.fromConfig(cfg.permission ?? {})
        expect(Permission.evaluate("bash", "bun test", rules).action).toBe("ask")
        expect(Permission.evaluate("edit", "src/index.ts", rules).action).toBe("deny")
      },
    })
  } finally {
    ;(Global.Path as { config: string }).config = previous
  }
})
