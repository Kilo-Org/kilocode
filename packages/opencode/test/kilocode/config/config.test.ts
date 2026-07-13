import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { HttpClient } from "effect/unstable/http"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { Config } from "../../../src/config/config"
import { ConfigMarkdown } from "../../../src/config/markdown"
import { ConfigParse } from "../../../src/config/parse"
import { Env } from "../../../src/env"
import { Git } from "../../../src/git"
import { KiloIndexing } from "../../../src/kilocode/indexing"
import { KilocodeConfig } from "../../../src/kilocode/config/config"
import { provideTestInstance } from "../../fixture/fixture"
import { Filesystem } from "../../../src/util/filesystem"
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
const clear = () =>
  Effect.runPromise(Config.Service.use((svc) => svc.invalidate()).pipe(Effect.scoped, Effect.provide(layer)))
const saveGlobal = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.updateGlobal(config)).pipe(Effect.scoped, Effect.provide(layer)))
const saveProject = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.update(config)).pipe(Effect.scoped, Effect.provide(layer)))

async function writeConfig(dir: string, config: object, name = "kilo.json") {
  await Filesystem.write(path.join(dir, name), JSON.stringify(config))
}

function decode(input: unknown): Config.Info {
  const config = Schema.decodeUnknownSync(Config.Info)(input)
  return {
    ...config,
    skills: config.skills && {
      paths: config.skills.paths && [...config.skills.paths],
      urls: config.skills.urls && [...config.skills.urls],
    },
  }
}

const cfg: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}

afterEach(async () => {
  delete process.env.KILO_MD_TEST
  await clear()
  await disposeAllInstances()
})

describe("markdown substitutions", () => {
  test("applies file and env substitutions to parsed markdown body", async () => {
    process.env.KILO_MD_TEST = "env content"
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "body.md"), "file content")
        await Filesystem.write(
          path.join(dir, "SKILL.md"),
          ["---", "name: test", "description: Test", "---", "{file:body.md}", "{env:KILO_MD_TEST}"].join("\n"),
        )
      },
    })

    const md = await ConfigMarkdown.parse(path.join(tmp.path, "SKILL.md"), { trusted: true })

    expect(md.content).toContain("file content")
    expect(md.content).toContain("env content")
  })
})

describe("kilocode indexing config", () => {
  test("ignores retired semantic indexing flags in existing configs", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeConfig(tmp.path, {
      experimental: { semantic_indexing: true, batch_tool: true },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        expect(config.experimental?.batch_tool).toBe(true)
        expect(config.experimental).not.toHaveProperty("semantic_indexing")
      },
    })
  })

  test("keeps global indexing enabled in global config", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()

    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await writeConfig(globalTmp.path, {
        $schema: "https://app.kilo.ai/config.json",
        indexing: {
          enabled: true,
          provider: "ollama",
        },
      })

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const config = await load()
          const global = await Effect.runPromise(
            Config.Service.use((svc) => svc.getGlobal()).pipe(Effect.scoped, Effect.provide(layer)),
          )
          expect(config.indexing?.provider).toBe("ollama")
          expect(config.indexing?.enabled).toBeUndefined()
          expect(global.indexing?.enabled).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })

  test("uses global indexing enabled when project enablement is unset", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true, config: cfg })

    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await writeConfig(globalTmp.path, {
        $schema: "https://app.kilo.ai/config.json",
        indexing: {
          enabled: true,
        },
      })

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const global = await Effect.runPromise(
            Config.Service.use((svc) => svc.getGlobal()).pipe(Effect.scoped, Effect.provide(layer)),
          )
          const config = await load()
          const input = KiloIndexing.input(config.indexing, global.indexing)
          expect(input.enabled).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })

  test("project indexing enabled overrides global enablement", async () => {
    const input = KiloIndexing.input({ enabled: false }, { enabled: true })
    expect(input.enabled).toBe(false)
    expect(KiloIndexing.input(undefined, { enabled: true }).enabled).toBe(true)
    expect(KiloIndexing.input({ enabled: true }, { enabled: false }).enabled).toBe(true)
  })

  test("creates missing project config as .kilo/kilo.jsonc", async () => {
    await using tmp = await tmpdir({ git: true })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        await saveProject({ indexing: { enabled: true } })
      },
    })

    expect(await Bun.file(path.join(tmp.path, ".kilo", "kilo.jsonc")).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, ".kilo", "kilo.json")).exists()).toBe(false)
  })

  test("accepts delete sentinels for indexing model overrides", () => {
    const patch = decode({ indexing: { model: null, dimension: null } })
    const merged = KilocodeConfig.mergeConfig(
      {
        indexing: {
          provider: "openai",
          model: "text-embedding-3-large",
          dimension: 3072,
        },
      },
      patch,
    )
    const input = KiloIndexing.input(patch.indexing)

    expect(merged.indexing).toEqual({ provider: "openai" })
    expect(input.modelId).toBeUndefined()
    expect(input.modelDimension).toBeUndefined()
  })
})

describe("kilocode sandbox config", () => {
  test("prevents project config from weakening sandbox policy", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })

    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await writeConfig(globalTmp.path, {
        $schema: "https://app.kilo.ai/config.json",
        sandbox: {
          enabled: true,
          network: "deny",
          writable_paths: ["/tmp/global"],
          allowed_hosts: ["api.github.com"],
        },
      })
      await writeConfig(tmp.path, {
        sandbox: {
          enabled: false,
          network: "allow",
          writable_paths: ["/tmp/project"],
          allowed_hosts: ["evil.example"],
        },
      })

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const config = await load()
          expect(config.sandbox).toEqual({
            enabled: true,
            network: "deny",
            writable_paths: ["/tmp/global"],
            allowed_hosts: ["api.github.com"],
          })
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })

  test("allows project config to strengthen sandbox policy", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })

    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await writeConfig(globalTmp.path, {
        sandbox: {
          enabled: false,
          network: "allow",
          writable_paths: ["/tmp/global"],
          allowed_hosts: ["api.github.com"],
        },
      })
      await writeConfig(tmp.path, {
        sandbox: {
          enabled: true,
          network: "deny",
          writable_paths: ["/tmp/project"],
          allowed_hosts: ["evil.example"],
        },
      })

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const config = await load()
          expect(config.sandbox).toEqual({
            enabled: true,
            network: "deny",
            writable_paths: ["/tmp/global"],
            allowed_hosts: [],
          })
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })
})

describe("custom provider model config", () => {
  test("persists and removes reasoning across a global config reload", async () => {
    await using globalTmp = await tmpdir()
    const file = path.join(globalTmp.path, "kilo.json")
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await writeConfig(globalTmp.path, {
        provider: {
          custom: {
            name: "Custom",
            models: { model: { name: "Model" } },
          },
        },
      })
      await saveGlobal(
        decode({
          provider: {
            custom: {
              models: { model: { reasoning: true } },
            },
          },
        }),
      )
      const added = JSON.parse(await Bun.file(file).text())
      expect(added.provider.custom.models.model.reasoning).toBe(true)

      await saveGlobal(
        decode({
          provider: {
            custom: {
              models: { model: { reasoning: null } },
            },
          },
        }),
      )
      const written = JSON.parse(await Bun.file(file).text())
      expect(written.provider.custom.models.model).not.toHaveProperty("reasoning")

      await clear()
      const reloaded = await Effect.runPromise(
        Config.Service.use((svc) => svc.getGlobal()).pipe(Effect.scoped, Effect.provide(layer)),
      )
      expect(reloaded.provider?.custom?.models?.model?.reasoning).toBeUndefined()
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })
})

describe("subagent variant overrides", () => {
  test("removes one model override without removing sibling models", () => {
    const patch = decode({
      subagent_variant_overrides: {
        "anthropic/claude-sonnet-4-6": null,
      },
    })
    const merged = KilocodeConfig.mergeConfig(
      {
        subagent_variant_overrides: {
          "anthropic/claude-sonnet-4-6": "high",
          "openai/gpt-5": "xhigh",
        },
      },
      patch,
    )

    expect(patch.subagent_variant_overrides?.["anthropic/claude-sonnet-4-6"]).toBeNull()
    expect(merged.subagent_variant_overrides).toEqual({ "openai/gpt-5": "xhigh" })
  })

  test("accepts a delete sentinel for the complete override map", () => {
    const patch = decode({ subagent_variant_overrides: null })
    const merged = KilocodeConfig.mergeConfig(
      {
        subagent_variant_overrides: {
          "anthropic/claude-sonnet-4-6": "high",
        },
      },
      patch,
    )

    expect(patch.subagent_variant_overrides).toBeNull()
    expect(merged.subagent_variant_overrides).toBeUndefined()
  })
})

describe("agent config", () => {
  test("accepts delete sentinels for agent model and variant overrides", () => {
    const patch = decode({ agent: { explore: { model: null, variant: null } } })
    const merged = KilocodeConfig.mergeConfig(
      {
        agent: {
          explore: {
            model: "kilo/anthropic/claude-sonnet-4-6",
            variant: "high",
          },
        },
      },
      patch,
    )

    expect(patch.agent?.explore?.model).toBeNull()
    expect(patch.agent?.explore?.variant).toBeNull()
    expect(merged.agent).toBeUndefined()
  })

  test("removes an agent variant override without removing its model", () => {
    const patch = decode({ agent: { explore: { variant: null } } })
    const merged = KilocodeConfig.mergeConfig(
      {
        agent: {
          explore: {
            model: "kilo/anthropic/claude-sonnet-4-6",
            variant: "high",
          },
        },
      },
      patch,
    )

    expect(patch.agent?.explore?.variant).toBeNull()
    expect(merged.agent?.explore).toEqual({ model: "kilo/anthropic/claude-sonnet-4-6" })
  })

  test("removes agent model and variant overrides from global JSONC config", async () => {
    await using globalTmp = await tmpdir()
    const file = path.join(globalTmp.path, "kilo.jsonc")
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    await clear()
    await disposeAllInstances()

    try {
      await Filesystem.write(
        file,
        [
          "{",
          "  // Preserve this comment while clearing overrides.",
          '  "agent": {',
          '    "explore": {',
          '      "model": "kilo/anthropic/claude-sonnet-4-6",',
          '      "variant": "high",',
          '      "description": "Keep me"',
          "    }",
          "  }",
          "}",
        ].join("\n"),
      )
      const patch = decode({ agent: { explore: { model: null, variant: null } } })

      await saveGlobal(patch)

      const written = await Bun.file(file).text()
      expect(written).toContain("// Preserve this comment while clearing overrides.")
      expect(written).not.toContain('"model"')
      expect(written).not.toContain('"variant"')
      expect(written).toContain('"description": "Keep me"')
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })
})

describe("project config directory precedence", () => {
  test("prefers .kilo over legacy .kilocode and ignores .opencode", async () => {
    await using tmp = await tmpdir()
    const entries = [
      {
        root: ".opencode",
        source: "opencode",
        config: {
          username: "opencode",
          model: "test/opencode",
          small_model: "test/opencode",
        },
        names: ["shared", "legacy", "opencode-only"],
      },
      {
        root: ".kilocode",
        source: "kilocode",
        config: {
          username: "kilocode",
          model: "test/kilocode",
        },
        names: ["shared", "legacy"],
      },
      {
        root: ".kilo",
        source: "kilo",
        config: {
          username: "kilo",
        },
        names: ["shared"],
      },
    ] as const

    for (const item of entries) {
      const dir = path.join(tmp.path, item.root)
      await writeConfig(dir, {
        $schema: "https://app.kilo.ai/config.json",
        ...item.config,
      })
      for (const name of item.names) {
        await Filesystem.write(
          path.join(dir, "command", `${name}.md`),
          `---\ndescription: ${item.source} command\n---\n${item.source} command template`,
        )
        await Filesystem.write(
          path.join(dir, "agent", `${name}.md`),
          `---\ndescription: ${item.source} agent\nmode: subagent\n---\n${item.source} agent prompt`,
        )
      }
      await Filesystem.write(path.join(dir, "plugin", `${item.source}.ts`), "export default {}")
    }

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const config = await load()

        expect(config.username).toBe("kilo")
        expect(config.model).toBe("test/kilocode")
        expect(config.small_model).toBeUndefined()

        expect(config.command?.shared).toMatchObject({
          description: "kilo command",
          template: "kilo command template",
        })
        expect(config.command?.legacy).toMatchObject({
          description: "kilocode command",
          template: "kilocode command template",
        })
        expect(config.command?.["opencode-only"]).toBeUndefined()

        expect(config.agent?.shared).toMatchObject({
          description: "kilo agent",
          prompt: "kilo agent prompt",
        })
        expect(config.agent?.legacy).toMatchObject({
          description: "kilocode agent",
          prompt: "kilocode agent prompt",
        })
        expect(config.agent?.["opencode-only"]).toBeUndefined()

        const plugins = JSON.stringify(config.plugin)
        expect(plugins).toContain("kilocode.ts")
        expect(plugins).toContain("kilo.ts")
        expect(plugins).not.toContain("opencode.ts")
      },
    })
  })
})

describe("linked worktree config", () => {
  test("uses primary config directories as local fallbacks", async () => {
    await using primary = await tmpdir({ git: true })
    const worktree = path.join(path.dirname(primary.path), `${path.basename(primary.path)}-config-feature`)
    await Bun.write(path.join(primary.path, "kilo.json"), JSON.stringify({ model: "test/primary" }))
    await $`git add kilo.json`.cwd(primary.path).quiet()
    await $`git commit -m config`.cwd(primary.path).quiet()
    await $`git worktree add -b config-sibling-worktree ${worktree}`.cwd(primary.path).quiet()

    try {
      await Bun.write(path.join(worktree, "kilo.json"), JSON.stringify({ model: "test/worktree" }))
      await Bun.write(
        path.join(primary.path, ".kilo", "kilo.jsonc"),
        JSON.stringify({ username: "primary-dir", indexing: { enabled: true } }),
      )
      await Bun.write(path.join(worktree, ".kilo", "kilo.jsonc"), JSON.stringify({ username: "worktree-dir" }))

      const config = await provideTestInstance({ directory: worktree, fn: load })

      expect(config.model).toBe("test/worktree")
      expect(config.username).toBe("worktree-dir")
      expect(config.indexing?.enabled).toBe(true)
    } finally {
      await $`git worktree remove --force ${worktree}`.cwd(primary.path).quiet().nothrow()
    }
  })

  test("uses nested primary config directories as local fallbacks", async () => {
    await using primary = await tmpdir({ git: true })
    const worktree = path.join(path.dirname(primary.path), `${path.basename(primary.path)}-config-nested`)
    const directory = path.join(worktree, "packages", "app")
    await $`git worktree add -b config-nested-worktree ${worktree}`.cwd(primary.path).quiet()

    try {
      await Bun.write(path.join(directory, "placeholder"), "")
      await Bun.write(
        path.join(primary.path, "packages", ".opencode", "kilo.jsonc"),
        JSON.stringify({ snapshot: true, autoupdate: false, share: "auto", default_agent: "opencode-only" }),
      )
      await Bun.write(
        path.join(primary.path, "packages", ".kilocode", "kilo.jsonc"),
        JSON.stringify({ snapshot: true, autoupdate: "notify", share: "disabled" }),
      )
      await Bun.write(path.join(primary.path, "packages", ".kilo", "kilo.jsonc"), JSON.stringify({ snapshot: false }))
      await Bun.write(path.join(directory, ".kilo", "kilo.jsonc"), JSON.stringify({ share: "manual" }))

      const config = await provideTestInstance({ directory, fn: load })

      expect(config.snapshot).toBe(false)
      expect(config.autoupdate).toBe("notify")
      expect(config.share).toBe("manual")
      expect(config.default_agent).toBeUndefined()
    } finally {
      await $`git worktree remove --force ${worktree}`.cwd(primary.path).quiet().nothrow()
    }
  })

  test("keeps KILO_CONFIG_DIR above the primary fallback", async () => {
    await using primary = await tmpdir({ git: true })
    await using explicit = await tmpdir()
    const worktree = path.join(path.dirname(primary.path), `${path.basename(primary.path)}-config-explicit`)
    await $`git worktree add -b config-explicit-worktree ${worktree}`.cwd(primary.path).quiet()
    await Bun.write(path.join(primary.path, ".kilo", "kilo.jsonc"), JSON.stringify({ username: "primary-dir" }))
    await Bun.write(path.join(explicit.path, "kilo.jsonc"), JSON.stringify({ username: "explicit-dir" }))
    const previous = process.env["KILO_CONFIG_DIR"]
    process.env["KILO_CONFIG_DIR"] = explicit.path

    try {
      const config = await provideTestInstance({ directory: worktree, fn: load })
      expect(config.username).toBe("explicit-dir")
    } finally {
      if (previous === undefined) delete process.env["KILO_CONFIG_DIR"]
      else process.env["KILO_CONFIG_DIR"] = previous
      await $`git worktree remove --force ${worktree}`.cwd(primary.path).quiet().nothrow()
    }
  })
})

describe("opencode config migration notice", () => {
  const withGlobalConfig = async <T>(dir: string, fn: () => Promise<T> | T): Promise<T> => {
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = dir
    try {
      return await fn()
    } finally {
      ;(Global.Path as { config: string }).config = prev
    }
  }

  test("detects a project .opencode directory", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()
    await Filesystem.write(path.join(tmp.path, ".opencode", "opencode.json"), JSON.stringify({ model: "test/legacy" }))

    // Isolate the global config dir so a real ~/.config/opencode on the host cannot interfere.
    await withGlobalConfig(path.join(globalTmp.path, "kilo"), () => {
      const found = KilocodeConfig.detectOpencodeConfig({ directory: tmp.path, scanProject: true })
      expect(found).toEqual([path.join(tmp.path, ".opencode")])
    })
  })

  test("detects a global opencode config directory", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()
    const opencodeDir = path.join(globalTmp.path, "opencode")
    await Filesystem.write(path.join(opencodeDir, "opencode.json"), JSON.stringify({ model: "test/legacy" }))

    await withGlobalConfig(path.join(globalTmp.path, "kilo"), () => {
      const found = KilocodeConfig.detectOpencodeConfig({ directory: tmp.path, scanProject: true })
      expect(found).toEqual([opencodeDir])
    })
  })

  test("skips the project scan when disabled", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()
    await Filesystem.write(path.join(tmp.path, ".opencode", "opencode.json"), JSON.stringify({ model: "test/legacy" }))

    await withGlobalConfig(path.join(globalTmp.path, "kilo"), () => {
      const found = KilocodeConfig.detectOpencodeConfig({ directory: tmp.path, scanProject: false })
      expect(found).toEqual([])
    })
  })

  test("builds a dismissible notification when opencode config exists", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()
    await Filesystem.write(path.join(tmp.path, ".opencode", "opencode.json"), JSON.stringify({ model: "test/legacy" }))

    await withGlobalConfig(path.join(globalTmp.path, "kilo"), () => {
      const notice = KilocodeConfig.opencodeConfigNotification({ directory: tmp.path, scanProject: true })
      expect(notice?.id).toBe(KilocodeConfig.OPENCODE_NOTIFICATION_ID)
      expect(notice?.message).toContain(path.join(tmp.path, ".opencode"))
      expect(notice?.action?.actionURL).toBe(KilocodeConfig.CONFIG_DOCS_URL)
      expect(notice?.showIn).toEqual(["cli", "extension"])
    })
  })

  test("returns no notification when nothing needs migrating", async () => {
    await using globalTmp = await tmpdir()
    await using tmp = await tmpdir()

    await withGlobalConfig(path.join(globalTmp.path, "kilo"), () => {
      const notice = KilocodeConfig.opencodeConfigNotification({ directory: tmp.path, scanProject: true })
      expect(notice).toBeUndefined()
    })
  })
})

describe("bash permission migration", () => {
  for (const action of ["allow", "ask", "deny"] as const) {
    test(`preserves string-form ${action} permission in jsonc`, async () => {
      const input = `{
  "$schema": "https://app.kilo.ai/config.json",
  "permission": "${action}"
}`
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Filesystem.write(path.join(dir, "kilo.jsonc"), input)
        },
      })

      const prev = Global.Path.config
      ;(Global.Path as { config: string }).config = tmp.path
      await clear()
      await disposeAllInstances()

      try {
        await KilocodeConfig.migrateBashPermission()

        const file = path.join(tmp.path, "kilo.jsonc")
        const text = await Filesystem.readText(file)
        const parsed = ConfigParse.schema(Config.Info, ConfigParse.jsonc(text, file), file)
        expect(text).toBe(input)
        expect(parsed.permission?.["*"]).toBe(action)
        expect(parsed.permission?.bash).toBeUndefined()
      } finally {
        ;(Global.Path as { config: string }).config = prev
        await clear()
        await disposeAllInstances()
      }
    })

    test(`preserves string-form ${action} permission in json`, async () => {
      const input = JSON.stringify({
        $schema: "https://app.kilo.ai/config.json",
        permission: action,
      })
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Filesystem.write(path.join(dir, "kilo.json"), input)
        },
      })

      const prev = Global.Path.config
      ;(Global.Path as { config: string }).config = tmp.path
      await clear()
      await disposeAllInstances()

      try {
        await KilocodeConfig.migrateBashPermission()

        const file = path.join(tmp.path, "kilo.json")
        const text = await Filesystem.readText(file)
        const parsed = ConfigParse.schema(Config.Info, ConfigParse.jsonc(text, file), file)
        expect(text).toBe(input)
        expect(parsed.permission?.["*"]).toBe(action)
        expect(parsed.permission?.bash).toBeUndefined()
      } finally {
        ;(Global.Path as { config: string }).config = prev
        await clear()
        await disposeAllInstances()
      }
    })
  }

  test("migrates object-form global permission in jsonc", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "kilo.jsonc"),
          `{
  "$schema": "https://app.kilo.ai/config.json",
  "permission": {
    "read": "allow"
  }
}`,
        )
      },
    })

    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = tmp.path
    await clear()
    await disposeAllInstances()

    try {
      await KilocodeConfig.migrateBashPermission()

      const file = path.join(tmp.path, "kilo.jsonc")
      const text = await Filesystem.readText(file)
      const parsed = ConfigParse.schema(Config.Info, ConfigParse.jsonc(text, file), file)
      expect(parsed.permission?.read).toBe("allow")
      expect(parsed.permission?.bash).toBe("allow")
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await clear()
      await disposeAllInstances()
    }
  })
})
