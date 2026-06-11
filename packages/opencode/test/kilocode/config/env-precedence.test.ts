import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import path from "path"
import fs from "fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { Config } from "../../../src/config/config"
import { Env } from "../../../src/env"
import { Npm } from "@opencode-ai/core/npm"
import { WithInstance } from "../../../src/project/with-instance"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)
const account = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})
const auth = Layer.mock(Auth.Service)({ all: () => Effect.succeed({}) })
const npm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
  add: () => Effect.die("not implemented"),
  which: () => Effect.succeed(Option.none()),
})
const layer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(auth),
  Layer.provide(account),
  Layer.provideMerge(infra),
  Layer.provide(npm),
)
const load = () => Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))

const original = {
  file: process.env.KILO_CONFIG,
  dir: process.env.KILO_CONFIG_DIR,
  content: process.env.KILO_CONFIG_CONTENT,
  managed: process.env.KILO_TEST_MANAGED_CONFIG_DIR,
  key: process.env.KILO_API_KEY,
  org: process.env.KILO_ORG_ID,
  flag: Flag.KILO_CONFIG,
  compact: Flag.KILO_DISABLE_AUTOCOMPACT,
  prune: Flag.KILO_DISABLE_PRUNE,
  share: Flag.KILO_AUTO_SHARE,
  update: Flag.KILO_DISABLE_AUTOUPDATE,
  notify: Flag.KILO_ALWAYS_NOTIFY_UPDATE,
  permission: Flag.KILO_PERMISSION,
}

function restore() {
  set("KILO_CONFIG", original.file)
  set("KILO_CONFIG_DIR", original.dir)
  set("KILO_CONFIG_CONTENT", original.content)
  set("KILO_TEST_MANAGED_CONFIG_DIR", original.managed)
  set("KILO_API_KEY", original.key)
  set("KILO_ORG_ID", original.org)
  Flag.KILO_CONFIG = original.flag
  Flag.KILO_DISABLE_AUTOCOMPACT = original.compact
  Flag.KILO_DISABLE_PRUNE = original.prune
  Flag.KILO_AUTO_SHARE = original.share
  Flag.KILO_DISABLE_AUTOUPDATE = original.update
  Flag.KILO_ALWAYS_NOTIFY_UPDATE = original.notify
  Flag.KILO_PERMISSION = original.permission
}

function set(key: keyof typeof process.env, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(async () => {
  restore()
  await disposeAllInstances()
})

describe("KILO config precedence", () => {
  test("environment config sources override project files in deterministic order", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "kilo.json"),
          JSON.stringify({ username: "project", share: "disabled", autoupdate: false }),
        )
        await Bun.write(path.join(dir, "env.json"), JSON.stringify({ username: "env-file" }))
        await fs.mkdir(path.join(dir, "env-dir"), { recursive: true })
        await Bun.write(path.join(dir, "env-dir", "kilo.json"), JSON.stringify({ username: "env-dir" }))
      },
    })

    const file = path.join(tmp.path, "env.json")
    process.env.KILO_CONFIG = file
    Flag.KILO_CONFIG = file
    process.env.KILO_CONFIG_DIR = path.join(tmp.path, "env-dir")
    process.env.KILO_CONFIG_CONTENT = JSON.stringify({ username: "env-content" })
    process.env.KILO_API_KEY = "env-token"
    process.env.KILO_ORG_ID = "env-org"
    Flag.KILO_AUTO_SHARE = true
    Flag.KILO_ALWAYS_NOTIFY_UPDATE = true

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        expect(config.username).toBe("env-content")
        expect(config.share).toBe("auto")
        expect(config.autoupdate).toBe("notify")
        expect(config.provider?.kilo?.options).toMatchObject({
          apiKey: "env-token",
          kilocodeOrganizationId: "env-org",
        })
      },
    })
  })

  test("KILO_CONFIG_DIR overrides KILO_CONFIG and project files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "kilo.json"), JSON.stringify({ username: "project" }))
        await Bun.write(path.join(dir, "env.json"), JSON.stringify({ username: "env-file" }))
        await fs.mkdir(path.join(dir, "env-dir"), { recursive: true })
        await Bun.write(path.join(dir, "env-dir", "kilo.json"), JSON.stringify({ username: "env-dir" }))
      },
    })

    const file = path.join(tmp.path, "env.json")
    process.env.KILO_CONFIG = file
    Flag.KILO_CONFIG = file
    process.env.KILO_CONFIG_DIR = path.join(tmp.path, "env-dir")
    delete process.env.KILO_CONFIG_CONTENT

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => expect((await load()).username).toBe("env-dir"),
    })
  })

  test("managed config remains stronger than environment config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "managed"), { recursive: true })
        await Bun.write(
          path.join(dir, "managed", "kilo.json"),
          JSON.stringify({
            username: "managed",
            share: "disabled",
            autoupdate: false,
            provider: {
              kilo: { options: { apiKey: "managed-token", kilocodeOrganizationId: "managed-org" } },
            },
          }),
        )
      },
    })

    process.env.KILO_CONFIG_CONTENT = JSON.stringify({ username: "env-content" })
    process.env.KILO_API_KEY = "env-token"
    process.env.KILO_ORG_ID = "env-org"
    process.env.KILO_TEST_MANAGED_CONFIG_DIR = path.join(tmp.path, "managed")
    Flag.KILO_AUTO_SHARE = true
    Flag.KILO_ALWAYS_NOTIFY_UPDATE = true

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        expect(config.username).toBe("managed")
        expect(config.share).toBe("disabled")
        expect(config.autoupdate).toBe(false)
        expect(config.provider?.kilo?.options).toMatchObject({
          apiKey: "managed-token",
          kilocodeOrganizationId: "managed-org",
        })
      },
    })
  })

  test("managed compaction policy overrides runtime environment overlays", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "managed"), { recursive: true })
        await Bun.write(
          path.join(dir, "managed", "kilo.json"),
          JSON.stringify({ compaction: { auto: true, prune: true } }),
        )
      },
    })

    Flag.KILO_DISABLE_AUTOCOMPACT = true
    Flag.KILO_DISABLE_PRUNE = true
    process.env.KILO_TEST_MANAGED_CONFIG_DIR = path.join(tmp.path, "managed")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => expect((await load()).compaction).toMatchObject({ auto: true, prune: true }),
    })
  })

  test("ignores malformed KILO_PERMISSION overlays", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "kilo.json"), JSON.stringify({ permission: { bash: "ask" } }))
      },
    })

    Flag.KILO_PERMISSION = "{malformed"

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => expect((await load()).permission).toEqual({ bash: "ask" }),
    })
  })
})
