// kilocode_change - new file
// Verifies that Config.permission_origins attributes each permission key to the scope
// (global XDG vs local project) that last set it, which drives auto-approval provenance.

import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
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
    Global.Path.config = previous
  }
})

test("global multi-pattern permission entries decide a project entry for the same key and pattern", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  await fs.mkdir(kilo, { recursive: true })
  await fs.mkdir(global, { recursive: true })
  await Bun.write(
    path.join(global, "kilo.json"),
    JSON.stringify({ permission: { bash: { "*": "allow", "rm *": "deny" }, edit: "deny" } }),
  )
  await Bun.write(
    path.join(kilo, "kilo.json"),
    JSON.stringify({ permission: { bash: { "rm *": "allow" }, webfetch: "deny" } }),
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
        expect(cfg.permission_layers).toHaveLength(2)
        expect(cfg.permission?.bash).toEqual({ "*": "allow", "rm *": "deny" })
        const rules = Permission.fromScopes(cfg.permission_layers, cfg.permission)
        expect(Permission.evaluate("bash", "rm -rf build", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "bun test", rules).action).toBe("allow")
        expect(Permission.evaluate("edit", "src/index.ts", rules).action).toBe("deny")
        // a project entry that the global config does not mention keeps applying
        expect(Permission.evaluate("webfetch", "https://example.com", rules).action).toBe("deny")
      },
    })
  } finally {
    Global.Path.config = previous
  }
})

test("global markdown source entries decide a project allow before markdown directories resolve", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const dir = path.join(tmp.path, "a")
  const kilo = path.join(dir, ".kilo")
  const shared = path.join(tmp.path, "shared", "agent")
  await fs.mkdir(kilo, { recursive: true })
  await fs.mkdir(global, { recursive: true })
  await fs.mkdir(shared, { recursive: true })
  const root = realpathSync.native(shared)
  await Bun.write(path.join(shared, "shared.md"), "Shared agent prompt.\n")
  await fs.symlink(shared, path.join(kilo, "agent"), "dir")
  await Bun.write(
    path.join(global, "kilo.json"),
    JSON.stringify({ permission: { markdown_source: { [`${root}/*`]: "deny" } } }),
  )
  await Bun.write(
    path.join(kilo, "kilo.json"),
    JSON.stringify({ permission: { markdown_source: { [`${root}/*`]: "allow" } } }),
  )

  const previous = Global.Path.config
  Global.Path.config = global
  try {
    await provideTestInstance({
      directory: dir,
      fn: async () => {
        const [cfg, warnings] = await Effect.runPromise(
          Config.Service.use((svc) => Effect.all([svc.get(), svc.warnings()])).pipe(
            Effect.scoped,
            Effect.provide(testLayer),
          ),
        )
        expect(cfg.permission?.markdown_source).toEqual({ [`${root}/*`]: "deny" })
        expect(cfg.permission_origins?.markdown_source).toEqual({ [`${root}/*`]: "global" })
        expect(cfg.agent?.shared).toBeUndefined()
        expect(warnings.some((warning) => warning.path.endsWith("shared.md"))).toBe(true)
      },
    })
  } finally {
    Global.Path.config = previous
  }
})
