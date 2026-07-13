// kilocode_change - new file

import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Config } from "../../src/config/config"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Npm } from "@opencode-ai/core/npm"
import { provideTestInstance } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { HttpClient } from "effect/unstable/http"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

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

const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)

const layer = Config.layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provideMerge(infra),
  Layer.provide(noopNpm),
  Layer.provide(Layer.succeed(HttpClient.HttpClient, unexpectedHttp)),
)

const load = () => Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))
const save = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.update(config)).pipe(Effect.scoped, Effect.provide(layer)))
const saveGlobal = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.updateGlobal(config)).pipe(Effect.scoped, Effect.provide(layer)))
const clear = () =>
  Effect.runPromise(Config.Service.use((svc) => svc.invalidate()).pipe(Effect.scoped, Effect.provide(layer)))

type Saved = {
  snapshot?: boolean
  username?: string
  indexing?: {
    provider?: string
    openai?: {
      apiKey?: string
      model?: string
    }
    lancedb?: {
      directory?: string
      apiKey?: string
    }
  }
  permission?: Record<string, string | Record<string, string>>
}

async function writeConfig(dir: string, config: unknown) {
  await Filesystem.write(path.join(dir, "kilo.json"), JSON.stringify(config, null, 2))
}

async function readConfig(dir: string) {
  return Filesystem.readJson<Saved>(path.join(dir, "kilo.json"))
}

function cleared(): Config.Info {
  return { permission: { "*": { "*": null } } } as unknown as Config.Info
}

function canary(): Saved {
  return {
    username: "alice",
    indexing: {
      provider: "openai",
      openai: {
        apiKey: "test-openai-key",
        model: "text-embedding-3-large",
      },
      lancedb: {
        directory: ".kilo/index",
        apiKey: "test-lancedb-key",
      },
    },
  }
}

test("project config update creates .kilo/kilo.jsonc and reloads it", async () => {
  await using tmp = await tmpdir()
  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await save({ model: "updated/model" } as any)

      const written = await Filesystem.readJson<{ model: string }>(path.join(tmp.path, ".kilo", "kilo.jsonc"))
      expect(written.model).toBe("updated/model")

      const loaded = await load()
      expect(loaded.model).toBe("updated/model")
    },
  })
})

test("project config update skips empty delete-only writes when no config exists", async () => {
  await using tmp = await tmpdir()
  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await save({ provider: { missing: null } } as any)

      await expect(fs.access(path.join(tmp.path, ".kilo", "kilo.jsonc"))).rejects.toThrow()
    },
  })
})

test("project config update prefers existing root kilo.json", async () => {
  await using tmp = await tmpdir()
  await writeConfig(tmp.path, { username: "alice" })

  await provideTestInstance({
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

  await provideTestInstance({
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

test("project config update preserves nested unmodeled keys in plain json", async () => {
  await using tmp = await tmpdir()
  await writeConfig(tmp.path, canary())

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await save({ snapshot: false })

      const saved = await Filesystem.readJson<Saved>(path.join(tmp.path, "kilo.json"))
      expect(saved.snapshot).toBe(false)
      expect(saved.indexing?.openai?.apiKey).toBe("test-openai-key")
      expect(saved.indexing?.openai?.model).toBe("text-embedding-3-large")
      expect(saved.indexing?.lancedb?.directory).toBe(".kilo/index")
      expect(saved.indexing?.lancedb?.apiKey).toBe("test-lancedb-key")
    },
  })
})

test("project config update ignores absent permission clear in plain json", async () => {
  await using tmp = await tmpdir()
  await writeConfig(tmp.path, { username: "alice" })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await save(cleared())

      const saved = await readConfig(tmp.path)
      expect(saved.username).toBe("alice")
      expect(saved.permission).toBeUndefined()
    },
  })
})

test("project config update deletes present permission in plain json", async () => {
  await using tmp = await tmpdir()
  await writeConfig(tmp.path, { username: "alice", permission: { "*": { "*": "allow", bash: "ask" } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await save(cleared())

      const saved = await readConfig(tmp.path)
      expect(saved.username).toBe("alice")
      expect(saved.permission?.["*"]).toEqual({ bash: "ask" })
    },
  })
})

test.serial("global config update preserves nested unmodeled keys in plain json", async () => {
  await using globalTmp = await tmpdir()
  await using tmp = await tmpdir()

  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  await clear()
  await disposeAllInstances()

  try {
    await writeConfig(globalTmp.path, canary())

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await saveGlobal({ snapshot: false })

        const saved = await Filesystem.readJson<Saved>(path.join(globalTmp.path, "kilo.json"))
        expect(saved.snapshot).toBe(false)
        expect(saved.indexing?.openai?.apiKey).toBe("test-openai-key")
        expect(saved.indexing?.openai?.model).toBe("text-embedding-3-large")
        expect(saved.indexing?.lancedb?.directory).toBe(".kilo/index")
        expect(saved.indexing?.lancedb?.apiKey).toBe("test-lancedb-key")
      },
    })
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear()
    await disposeAllInstances()
  }
})

test.serial("global config update ignores absent permission clear in plain json", async () => {
  await using globalTmp = await tmpdir()
  await using tmp = await tmpdir()

  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  await clear()
  await disposeAllInstances()

  try {
    await writeConfig(globalTmp.path, { username: "alice" })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await saveGlobal(cleared())

        const saved = await readConfig(globalTmp.path)
        expect(saved.username).toBe("alice")
        expect(saved.permission).toBeUndefined()
      },
    })
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear()
    await disposeAllInstances()
  }
})

test.serial("global config update deletes present permission in plain json", async () => {
  await using globalTmp = await tmpdir()
  await using tmp = await tmpdir()

  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  await clear()
  await disposeAllInstances()

  try {
    await writeConfig(globalTmp.path, { username: "alice", permission: { "*": { "*": "allow", bash: "ask" } } })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await saveGlobal(cleared())

        const saved = await readConfig(globalTmp.path)
        expect(saved.username).toBe("alice")
        expect(saved.permission?.["*"]).toEqual({ bash: "ask" })
      },
    })
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear()
    await disposeAllInstances()
  }
})
