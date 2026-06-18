import { test, expect, describe, afterEach, beforeEach } from "bun:test"
import { Effect, Exit, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Config } from "@/config/config"
import { ConfigManaged } from "@/config/managed"
import { ConfigParse } from "../../src/config/parse"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"

import { InstanceRef } from "../../src/effect/instance-ref"
import type { InstanceContext } from "../../src/project/instance-context"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { AccessToken, AccountID, OrgID } from "../../src/account/schema"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Env } from "../../src/env"
import {
  provideTestInstance,
  provideTmpdirInstance,
  TestInstance,
  tmpdir,
  tmpdirScoped,
  withTestInstance,
} from "../fixture/fixture"
import { InstanceRuntime } from "@/project/instance-runtime"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

/** Infra layer that provides FileSystem, Path, ChildProcessSpawner for test fixtures */
const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { Global } from "@opencode-ai/core/global"
import { ProjectID } from "../../src/project/schema"
import { Filesystem } from "@/util/filesystem"
import { ConfigPlugin } from "@/config/plugin"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { isIndexingPlugin } from "@kilocode/kilo-indexing/detect" // kilocode_change
import { isAtomicChatPlugin } from "@/kilocode/atomic-chat-feature" // kilocode_change

const testFlock = EffectFlock.defaultLayer

const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)

const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const wellKnownAuth = (url: string) =>
  Layer.mock(Auth.Service)({
    all: () =>
      Effect.succeed({
        [url]: new Auth.WellKnown({ type: "wellknown", key: "TEST_TOKEN", token: "test-token" }),
      }),
  })

function remoteConfigClient(input: {
  wellKnown: unknown
  remote?: unknown
  seen: { wellKnown?: string; remote?: string; authorization?: string }
}) {
  return HttpClient.make((request) => {
    if (request.url.includes(".well-known/opencode")) {
      input.seen.wellKnown = request.url
      return Effect.succeed(json(request, input.wellKnown))
    }
    if (input.remote !== undefined && request.url.includes("config.example.com")) {
      input.seen.remote = request.url
      input.seen.authorization = request.headers.authorization
      return Effect.succeed(json(request, input.remote))
    }
    return Effect.succeed(json(request, {}, 404))
  })
}

const configLayer = (
  options: {
    auth?: Layer.Layer<Auth.Service>
    account?: Layer.Layer<Account.Service>
    client?: HttpClient.HttpClient
  } = {},
) =>
  Config.layer.pipe(
    Layer.provide(testFlock),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(options.auth ?? AuthTest.empty),
    Layer.provide(options.account ?? AccountTest.empty),
    Layer.provideMerge(infra),
    Layer.provide(NpmTest.noop),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, options.client ?? unexpectedHttp)),
  )

const layer = configLayer()

const it = testEffect(layer)

const provideCurrentInstance = <A, E, R>(effect: Effect.Effect<A, E, R>, ctx: InstanceContext) =>
  effect.pipe(Effect.provideService(InstanceRef, ctx))

const load = (ctx: InstanceContext) =>
  Effect.runPromise(
    Config.Service.use((svc) => provideCurrentInstance(svc.get(), ctx)).pipe(Effect.scoped, Effect.provide(layer)),
  )
const saveGlobal = (config: Config.Info) =>
  Effect.runPromise(
    Config.use.updateGlobal(config).pipe(
      Effect.map((result) => result.info),
      Effect.scoped,
      Effect.provide(layer),
    ),
  )
const clear = async (wait = false) => {
  await Effect.runPromise(Config.use.invalidate().pipe(Effect.scoped, Effect.provide(layer)))
  if (wait) await InstanceRuntime.disposeAllInstances()
}
const listDirs = (ctx: InstanceContext) =>
  Effect.runPromise(
    Config.Service.use((svc) => provideCurrentInstance(svc.directories(), ctx)).pipe(
      Effect.scoped,
      Effect.provide(layer),
    ),
  )
// Get managed config directory from environment (set in preload.ts)
const managedConfigDir = process.env.KILO_TEST_MANAGED_CONFIG_DIR!
const originalTestToken = process.env.TEST_TOKEN

beforeEach(async () => {
  await clear(true)
})

afterEach(async () => {
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
  if (originalTestToken === undefined) delete process.env.TEST_TOKEN
  else process.env.TEST_TOKEN = originalTestToken
  await clear(true)
})

// kilocode_change start
async function writeManagedSettings(settings: object, filename = "kilo.json") {
  // kilocode_change end
  await fs.mkdir(managedConfigDir, { recursive: true })
  await Filesystem.write(path.join(managedConfigDir, filename), JSON.stringify(settings))
}

const writeManagedSettingsEffect = (settings: object, filename?: string) =>
  Effect.promise(() => writeManagedSettings(settings, filename))

// kilocode_change start
async function writeConfig(dir: string, config: object, name = "kilo.json") {
  // kilocode_change end
  await Filesystem.write(path.join(dir, name), JSON.stringify(config))
}

// kilocode_change start
const writeConfigEffect = (dir: string, config: object, name = "kilo.json") =>
  // kilocode_change end
  Effect.promise(() => writeConfig(dir, config, name))
const mkdirEffect = (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true }))
const writeTextEffect = (file: string, content: string) => Effect.promise(() => Filesystem.write(file, content))

function withProcessEnv<A, E, R>(key: string, value: string | undefined, effect: Effect.Effect<A, E, R>) {
  return withProcessEnvs({ [key]: value }, effect)
}

function withProcessEnvs<A, E, R>(entries: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const originals: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(entries)) {
        originals[key] = process.env[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return originals
    }),
    () => effect,
    (originals) =>
      Effect.sync(() => {
        for (const [key, original] of Object.entries(originals)) {
          if (original !== undefined) process.env[key] = original
          else delete process.env[key]
        }
      }),
  )
}

async function check(map: (dir: string) => string) {
  if (process.platform !== "win32") return
  await using globalTmp = await tmpdir()
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  await clear()
  try {
    await writeConfig(globalTmp.path, {
      $schema: "https://opencode.ai/config.json",
      snapshot: false,
    })
    await withTestInstance({
      directory: map(tmp.path),
      fn: async (ctx) => {
        const cfg = await load(ctx)
        expect(cfg.snapshot).toBe(true)
        expect(ctx.directory).toBe(Filesystem.resolve(tmp.path))
        expect(ctx.project.id).not.toBe(ProjectID.global)
      },
    })
  } finally {
    await InstanceRuntime.disposeAllInstances()
    ;(Global.Path as { config: string }).config = prev
    await clear()
  }
}

it.instance("loads config with defaults when no files exist", () =>
  Effect.gen(function* () {
    const config = yield* Config.use.get()
    expect(config.username).toBeDefined()
  }),
)

test("creates global jsonc config with schema when no global configs exist", async () => {
  await using tmp = await tmpdir()
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path
  await clear(true)

  try {
    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        await load(ctx)
      },
    })

    const content = await Filesystem.readText(path.join(tmp.path, "kilo.jsonc")) // kilocode_change
    expect(content).toContain('"$schema": "https://app.kilo.ai/config.json"') // kilocode_change
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear(true)
  }
})

test("does not create global config when KILO_CONFIG_DIR is set", async () => {
  await using tmp = await tmpdir()
  await using custom = await tmpdir()
  const prevConfig = Global.Path.config
  const prevEnv = process.env.KILO_CONFIG_DIR
  ;(Global.Path as { config: string }).config = tmp.path
  process.env.KILO_CONFIG_DIR = custom.path
  await clear(true)

  try {
    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        await load(ctx)
      },
    })

    expect(await Filesystem.exists(path.join(tmp.path, "opencode.jsonc"))).toBe(false)
  } finally {
    ;(Global.Path as { config: string }).config = prevConfig
    if (prevEnv === undefined) delete process.env.KILO_CONFIG_DIR
    else process.env.KILO_CONFIG_DIR = prevEnv
    await clear(true)
  }
})

it.instance("loads JSON config file", () =>
  Effect.gen(function* () {
    // kilocode_change start
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json",
      model: "test/model",
      username: "testuser",
    })
    // kilocode_change end
    const config = yield* Config.use.get()
    expect(config.model).toBe("test/model")
    expect(config.username).toBe("testuser")
  }),
)

// kilocode_change start
it.instance("preserves Kilo provider free model metadata", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json",
      model: "kilo/free-e2e",
      provider: {
        kilo: {
          models: {
            "free-e2e": {
              id: "free-e2e",
              isFree: true,
              ai_sdk_provider: "openai-compatible",
            },
          },
        },
      },
    })
    const config = yield* Config.use.get()
    const model = config.provider?.kilo?.models?.["free-e2e"]
    expect(model?.isFree).toBe(true)
    expect(model?.ai_sdk_provider).toBe("openai-compatible")
  }),
)
// kilocode_change end

it.instance(
  "loads shell config field",
  Effect.gen(function* () {
    const config = yield* Config.use.get()
    expect(config.shell).toBe("bash")
  }),
  { config: { shell: "bash" } },
)

it.instance("updates config and preserves empty shell sentinel", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // kilocode_change - upstream hardcodes project config to config.json; Kilo writes to kilo.json
    yield* writeConfigEffect(test.directory, { $schema: "https://opencode.ai/config.json", shell: "bash" })

    yield* Config.Service.use((svc) => svc.update(ConfigParse.schema(Config.Info, { shell: "" }, "test:config")))

    const writtenConfig = yield* Effect.promise(
      () => Filesystem.readJson<{ shell?: string }>(path.join(test.directory, "kilo.json")), // kilocode_change
    )
    expect(writtenConfig.shell).toBe("")
  }),
)

test("updates global config and omits empty shell key in json", async () => {
  // kilocode_change - globalConfigFile() prefers kilo.json over opencode.json
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencode.ai/config.json",
        shell: "bash",
      })
    },
  })

  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path
  await clear(true)

  try {
    await saveGlobal({ shell: "" })

    const writtenConfig = await Filesystem.readJson<{ shell?: string }>(
      path.join(tmp.path, "kilo.json"), // kilocode_change
    )
    expect("shell" in writtenConfig).toBe(false)
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear(true)
  }
})

test("updates global config and omits empty shell key in jsonc", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.jsonc"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          shell: "bash",
          model: "test/model",
        }),
      )
    },
  })

  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path
  await clear(true)

  try {
    await saveGlobal({ shell: "" })

    const file = path.join(tmp.path, "opencode.jsonc")
    const writtenConfig = await Filesystem.readText(file)
    const parsed = ConfigParse.schema(Config.Info, ConfigParse.jsonc(writtenConfig, file), file)
    expect(writtenConfig).not.toContain('"shell"')
    expect(parsed.shell).toBeUndefined()
    expect(parsed.model).toBe("test/model")
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear(true)
  }
})

it.instance(
  "loads formatter boolean config",
  Effect.gen(function* () {
    const config = yield* Config.use.get()
    expect(config.formatter).toBe(true)
  }),
  { config: { formatter: true } },
)

it.instance(
  "loads lsp boolean config",
  Effect.gen(function* () {
    const config = yield* Config.use.get()
    expect(config.lsp).toBe(true)
  }),
  { config: { lsp: true } },
)

test("loads project config from Git Bash and MSYS2 paths on Windows", async () => {
  // Git Bash and MSYS2 both use /<drive>/... paths on Windows.
  await check((dir) => {
    const drive = dir[0].toLowerCase()
    const rest = dir.slice(2).replaceAll("\\", "/")
    return `/${drive}${rest}`
  })
})

test("loads project config from Cygwin paths on Windows", async () => {
  await check((dir) => {
    const drive = dir[0].toLowerCase()
    const rest = dir.slice(2).replaceAll("\\", "/")
    return `/cygdrive/${drive}${rest}`
  })
})

it.instance("ignores legacy tui keys in opencode config", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://opencode.ai/config.json",
      model: "test/model",
      theme: "legacy",
      tui: { scroll_speed: 4 },
    })

    const config = yield* Config.use.get()
    expect(config.model).toBe("test/model")
    expect((config as Record<string, unknown>).theme).toBeUndefined()
    expect((config as Record<string, unknown>).tui).toBeUndefined()
  }),
)

it.instance("loads JSONC config file", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.promise(() =>
      Filesystem.write(
        // kilocode_change start
        path.join(test.directory, "kilo.jsonc"),
        `{
        // This is a comment
        "$schema": "https://app.kilo.ai/config.json",
        "model": "test/model",
        "username": "testuser"
      }`,
        // kilocode_change end
      ),
    )
    const config = yield* Config.use.get()
    expect(config.model).toBe("test/model")
    expect(config.username).toBe("testuser")
  }),
)

it.instance("jsonc overrides json in the same directory", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(
      test.directory,
      {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        model: "base",
        username: "base",
      },
      "kilo.jsonc", // kilocode_change
    )
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      model: "override",
    })
    const config = yield* Config.use.get()
    expect(config.model).toBe("base")
    expect(config.username).toBe("base")
  }),
)

// kilocode_change start
it.instance("prefers .kilo directory config over legacy .kilocode", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(path.join(test.directory, ".kilocode"), {
      $schema: "https://app.kilo.ai/config.json",
      model: "legacy/model",
    })
    yield* writeConfigEffect(path.join(test.directory, ".kilo"), {
      $schema: "https://app.kilo.ai/config.json",
      model: "new/model",
    })

    const config = yield* Config.use.get()
    expect(config.model).toBe("new/model")
  }),
)
// kilocode_change end

it.instance("handles environment variable substitution", () =>
  withProcessEnv(
    "TEST_VAR",
    "test-user",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeConfigEffect(test.directory, {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        username: "{env:TEST_VAR}",
      })
      const config = yield* Config.use.get()
      expect(config.username).toBe("test-user")
    }),
  ),
)

it.instance("preserves env variables when adding $schema to config", () =>
  withProcessEnv(
    "PRESERVE_VAR",
    "secret_value",
    Effect.gen(function* () {
      const test = yield* TestInstance
      // Config without $schema - should trigger auto-add
      yield* Effect.promise(() =>
        Filesystem.write(
          path.join(test.directory, "kilo.json"), // kilocode_change
          JSON.stringify({
            username: "{env:PRESERVE_VAR}",
          }),
        ),
      )
      const config = yield* Config.use.get()
      expect(config.username).toBe("secret_value")

      // Read the file to verify the env variable was preserved
      const content = yield* Effect.promise(
        () => Filesystem.readText(path.join(test.directory, "kilo.json")), // kilocode_change
      )
      expect(content).toContain("{env:PRESERVE_VAR}")
      expect(content).not.toContain("secret_value")
      expect(content).toContain("$schema")
    }),
  ),
)

it.instance("handles file inclusion substitution", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.promise(() => Filesystem.write(path.join(test.directory, "included.txt"), "test-user"))
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      username: "{file:included.txt}",
    })
    const config = yield* Config.use.get()
    expect(config.username).toBe("test-user")
  }),
)

it.instance("handles file inclusion with replacement tokens", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.promise(() =>
      Filesystem.write(path.join(test.directory, "included.md"), "const out = await Bun.$`echo hi`"),
    )
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      username: "{file:included.md}",
    })
    const config = yield* Config.use.get()
    expect(config.username).toBe("const out = await Bun.$`echo hi`")
  }),
)

test("resolves env templates in account config with account token", async () => {
  const originalControlToken = process.env["KILO_CONSOLE_TOKEN"]

  const fakeAccount = Layer.mock(Account.Service)({
    active: () =>
      Effect.succeed(
        Option.some({
          id: AccountID.make("account-1"),
          email: "user@example.com",
          url: "https://control.example.com",
          active_org_id: OrgID.make("org-1"),
        }),
      ),
    activeOrg: () =>
      Effect.succeed(
        Option.some({
          account: {
            id: AccountID.make("account-1"),
            email: "user@example.com",
            url: "https://control.example.com",
            active_org_id: OrgID.make("org-1"),
          },
          org: {
            id: OrgID.make("org-1"),
            name: "Example Org",
          },
        }),
      ),
    config: () =>
      Effect.succeed(
        Option.some({
          provider: { opencode: { options: { apiKey: "{env:KILO_CONSOLE_TOKEN}" } } },
        }),
      ),
    token: () => Effect.succeed(Option.some(AccessToken.make("st_test_token"))),
  })

  const layer = configLayer({ account: fakeAccount })

  try {
    await provideTmpdirInstance(() =>
      Config.Service.use((svc) =>
        Effect.gen(function* () {
          const config = yield* svc.get()
          expect(config.provider?.["opencode"]?.options?.apiKey).toBe("st_test_token")
        }),
      ),
    ).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
  } finally {
    if (originalControlToken !== undefined) {
      process.env["KILO_CONSOLE_TOKEN"] = originalControlToken
    } else {
      delete process.env["KILO_CONSOLE_TOKEN"]
    }
  }
})

// kilocode_change start
it.instance("validates config schema and reports warning on invalid fields", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json",
      invalid_field: "should cause error",
    })
    // invalid schema surfaces as warnings, not a throw
    yield* Config.use.get()
    const issues = yield* Config.Service.use((svc) => svc.warnings())
    expect(issues.length).toBeGreaterThan(0)
  }),
)
// kilocode_change end

// kilocode_change start
it.instance("reports warning for invalid JSON", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.promise(() => Filesystem.write(path.join(test.directory, "kilo.json"), "{ invalid json }"))
    // invalid JSON surfaces as a warning, not a throw
    yield* Config.use.get()
    const issues = yield* Config.Service.use((svc) => svc.warnings())
    expect(issues.length).toBeGreaterThan(0)
  }),
)
// kilocode_change end

it.instance("handles agent configuration", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: {
        test_agent: {
          model: "test/model",
          temperature: 0.7,
          description: "test agent",
        },
      },
    })
    const config = yield* Config.use.get()
    expect(config.agent?.["test_agent"]).toEqual(
      expect.objectContaining({
        model: "test/model",
        temperature: 0.7,
        description: "test agent",
      }),
    )
  }),
)

it.instance("treats agent variant as model-scoped setting (not provider option)", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: {
        test_agent: {
          model: "openai/gpt-5.2",
          variant: "xhigh",
          max_tokens: 123,
        },
      },
    })
    const config = yield* Config.use.get()
    const agent = config.agent?.["test_agent"]

    expect(agent?.variant).toBe("xhigh")
    expect(agent?.options).toMatchObject({
      max_tokens: 123,
    })
    expect(agent?.options).not.toHaveProperty("variant")
  }),
)

it.instance("handles command configuration", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      command: {
        test_command: {
          template: "test template",
          description: "test command",
          agent: "test_agent",
        },
      },
    })
    const config = yield* Config.use.get()
    expect(config.command?.["test_command"]).toEqual({
      template: "test template",
      description: "test command",
      agent: "test_agent",
    })
  }),
)

it.instance("migrates autoshare to share field", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      autoshare: true,
    })
    const config = yield* Config.use.get()
    expect(config.share).toBe("auto")
    expect(config.autoshare).toBe(true)
  }),
)

it.instance("migrates mode field to agent field", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      mode: {
        test_mode: {
          model: "test/model",
          temperature: 0.5,
        },
      },
    })
    const config = yield* Config.use.get()
    expect(config.agent?.["test_mode"]).toEqual({
      model: "test/model",
      temperature: 0.5,
      mode: "primary",
      options: {},
      permission: {},
    })
  }),
)

// kilocode_change start
it.instance("loads config from .kilo directory", () =>
  // kilocode_change end
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".kilo", "agent")) // kilocode_change
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "agent", "test.md"), // kilocode_change
      `---
model: test/model
---
Test agent prompt`,
    )

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]).toEqual(
      expect.objectContaining({
        name: "test",
        model: "test/model",
        prompt: "Test agent prompt",
      }),
    )
  }),
)

it.instance("agent markdown permission config preserves user key order", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".opencode", "agent"))
    yield* writeTextEffect(
      path.join(test.directory, ".opencode", "agent", "ordered.md"),
      `---
permission:
  bash: allow
  "*": deny
  edit: ask
---
Ordered permissions`,
    )

    const config = yield* Config.use.get()
    expect(Object.keys(config.agent?.ordered?.permission ?? {})).toEqual(["bash", "*", "edit"])
  }),
)

// kilocode_change start
it.instance("loads agents from .kilo/agents (plural)", () =>
  // kilocode_change end
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".kilo", "agents", "nested")) // kilocode_change
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "agents", "helper.md"), // kilocode_change
      `---
model: test/model
mode: subagent
---
Helper agent prompt`,
    )

    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "agents", "nested", "child.md"), // kilocode_change
      `---
model: test/model
mode: subagent
---
Nested agent prompt`,
    )

    const config = yield* Config.use.get()

    expect(config.agent?.["helper"]).toMatchObject({
      name: "helper",
      model: "test/model",
      mode: "subagent",
      prompt: "Helper agent prompt",
    })

    expect(config.agent?.["nested/child"]).toMatchObject({
      name: "nested/child",
      model: "test/model",
      mode: "subagent",
      prompt: "Nested agent prompt",
    })
  }),
)

// kilocode_change start
it.instance("loads commands from .kilo/command (singular)", () =>
  // kilocode_change end
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".kilo", "command", "nested")) // kilocode_change
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "command", "hello.md"), // kilocode_change
      `---
description: Test command
---
Hello from singular command`,
    )

    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "command", "nested", "child.md"), // kilocode_change
      `---
description: Nested command
---
Nested command template`,
    )

    const config = yield* Config.use.get()

    expect(config.command?.["hello"]).toEqual({
      description: "Test command",
      template: "Hello from singular command",
    })

    expect(config.command?.["nested/child"]).toEqual({
      description: "Nested command",
      template: "Nested command template",
    })
  }),
)

// kilocode_change start
it.instance("loads commands from .kilo/commands (plural)", () =>
  // kilocode_change end
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".kilo", "commands", "nested")) // kilocode_change
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "commands", "hello.md"), // kilocode_change
      `---
description: Test command
---
Hello from plural commands`,
    )

    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "commands", "nested", "child.md"), // kilocode_change
      `---
description: Nested command
---
Nested command template`,
    )

    const config = yield* Config.use.get()

    expect(config.command?.["hello"]).toEqual({
      description: "Test command",
      template: "Hello from plural commands",
    })

    expect(config.command?.["nested/child"]).toEqual({
      description: "Nested command",
      template: "Nested command template",
    })
  }),
)

// kilocode_change start
it.instance("prefers .kilo commands over legacy .kilocode commands", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeTextEffect(
      path.join(test.directory, ".kilocode", "command", "hello.md"),
      `---
description: Legacy command
---
Hello from legacy command`,
    )
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "command", "hello.md"),
      `---
description: New command
---
Hello from new command`,
    )

    const config = yield* Config.use.get()
    expect(config.command?.["hello"]).toEqual({
      description: "New command",
      template: "Hello from new command",
    })
  }),
)
// kilocode_change end

it.instance("updates config and writes to file", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Config.Service.use((svc) =>
      svc.update(ConfigParse.schema(Config.Info, { model: "updated/model" }, "test:config")),
    )

    const writtenConfig = yield* Effect.promise(
      () => Filesystem.readJson<{ model: string }>(path.join(test.directory, ".kilo", "kilo.jsonc")), // kilocode_change
    )
    expect(writtenConfig.model).toBe("updated/model")
  }),
)

it.instance("gets config directories", () =>
  Effect.gen(function* () {
    const dirs = yield* Config.use.directories()
    expect(dirs.length).toBeGreaterThanOrEqual(1)
  }),
)

test("does not try to install dependencies in read-only KILO_CONFIG_DIR", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.mkdir(ro, { recursive: true })
      await fs.chmod(ro, 0o555)
      return ro
    },
    dispose: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.chmod(ro, 0o755).catch(() => {})
      return ro
    },
  })

  const prev = process.env.KILO_CONFIG_DIR
  process.env.KILO_CONFIG_DIR = tmp.extra

  try {
    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        await load(ctx)
      },
    })
  } finally {
    if (prev === undefined) delete process.env.KILO_CONFIG_DIR
    else process.env.KILO_CONFIG_DIR = prev
  }
})

test("installs dependencies in writable KILO_CONFIG_DIR", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const cfg = path.join(dir, "configdir")
      await fs.mkdir(cfg, { recursive: true })
      return cfg
    },
  })

  const prev = process.env.KILO_CONFIG_DIR
  process.env.KILO_CONFIG_DIR = tmp.extra

  const testLayer = configLayer()

  try {
    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        await Effect.runPromise(
          Config.Service.use((svc) => svc.get().pipe(Effect.provideService(InstanceRef, ctx))).pipe(
            Effect.scoped,
            Effect.provide(testLayer),
          ),
        )
        await Effect.runPromise(
          Config.Service.use((svc) => svc.waitForDependencies().pipe(Effect.provideService(InstanceRef, ctx))).pipe(
            Effect.scoped,
            Effect.provide(testLayer),
          ),
        )
      },
    })

    expect(await Filesystem.exists(path.join(tmp.extra, ".gitignore"))).toBe(true)
    expect(await Filesystem.readText(path.join(tmp.extra, ".gitignore"))).toContain("package-lock.json")
  } finally {
    if (prev === undefined) delete process.env.KILO_CONFIG_DIR
    else process.env.KILO_CONFIG_DIR = prev
  }
})

// Note: deduplication and serialization of npm installs is now handled by the
// core Npm.Service (via EffectFlock). Those behaviors are tested in the core
// package's npm tests, not here.

it.instance("resolves scoped npm plugins in config", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const pluginDir = path.join(test.directory, "node_modules", "@scope", "plugin")
    yield* mkdirEffect(pluginDir)
    yield* writeTextEffect(
      path.join(test.directory, "package.json"),
      JSON.stringify({ name: "config-fixture", version: "1.0.0", type: "module" }, null, 2),
    )
    yield* writeTextEffect(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: "@scope/plugin",
          version: "1.0.0",
          type: "module",
          main: "./index.js",
        },
        null,
        2,
      ),
    )
    yield* writeTextEffect(path.join(pluginDir, "index.js"), "export default {}\n")
    yield* writeConfigEffect(test.directory, { plugin: ["@scope/plugin"] })

    const config = yield* Config.use.get()
    expect(config.plugin ?? []).toContain("@scope/plugin")
  }),
)

test("merges plugin arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // kilocode_change - Create a nested project structure with local .kilo config
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".kilo") // kilocode_change
      await fs.mkdir(opencodeDir, { recursive: true })

      // Global config with plugins
      await Filesystem.write(
        path.join(dir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: ["global-plugin-1", "global-plugin-2"],
        }),
      )

      // kilocode_change - Local .kilo config with different plugins
      await Filesystem.write(
        path.join(opencodeDir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: ["local-plugin-1"],
        }),
      )
    },
  })

  await provideTestInstance({
    directory: path.join(tmp.path, "project"),
    fn: async (ctx) => {
      const config = await load(ctx)
      const plugins = config.plugin ?? []

      // Should contain both global and local plugins
      expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("global-plugin-2"))).toBe(true)
      expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)

      // Should have all 3 plugins (not replaced, but merged)
      const pluginNames = plugins.filter((p) => p.includes("global-plugin") || p.includes("local-plugin"))
      expect(pluginNames.length).toBeGreaterThanOrEqual(3)
    },
  })
})

it.instance("does not error when only custom agent is a subagent", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* mkdirEffect(path.join(test.directory, ".kilo", "agent")) // kilocode_change
    yield* writeTextEffect(
      path.join(test.directory, ".kilo", "agent", "helper.md"), // kilocode_change
      `---
model: test/model
mode: subagent
---
Helper subagent prompt`,
    )

    const config = yield* Config.use.get()
    expect(config.agent?.["helper"]).toMatchObject({
      name: "helper",
      model: "test/model",
      mode: "subagent",
      prompt: "Helper subagent prompt",
    })
  }),
)

test("merges instructions arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".kilo") // kilocode_change
      await fs.mkdir(opencodeDir, { recursive: true })

      await Filesystem.write(
        path.join(dir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          instructions: ["global-instructions.md", "shared-rules.md"],
        }),
      )

      await Filesystem.write(
        path.join(opencodeDir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          instructions: ["local-instructions.md"],
        }),
      )
    },
  })

  await withTestInstance({
    directory: path.join(tmp.path, "project"),
    fn: async (ctx) => {
      const config = await load(ctx)
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-instructions.md")
      expect(instructions).toContain("shared-rules.md")
      expect(instructions).toContain("local-instructions.md")
      expect(instructions.length).toBe(3)
    },
  })
})

test("deduplicates duplicate instructions from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".kilo") // kilocode_change
      await fs.mkdir(opencodeDir, { recursive: true })

      await Filesystem.write(
        path.join(dir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          instructions: ["duplicate.md", "global-only.md"],
        }),
      )

      await Filesystem.write(
        path.join(opencodeDir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          instructions: ["duplicate.md", "local-only.md"],
        }),
      )
    },
  })

  await withTestInstance({
    directory: path.join(tmp.path, "project"),
    fn: async (ctx) => {
      const config = await load(ctx)
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-only.md")
      expect(instructions).toContain("local-only.md")
      expect(instructions).toContain("duplicate.md")

      const duplicates = instructions.filter((i) => i === "duplicate.md")
      expect(duplicates.length).toBe(1)
      expect(instructions.length).toBe(3)
    },
  })
})

test("deduplicates duplicate plugins from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // kilocode_change - Create a nested project structure with local .kilo config
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".kilo") // kilocode_change
      await fs.mkdir(opencodeDir, { recursive: true })

      // Global config with plugins
      await Filesystem.write(
        path.join(dir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: ["duplicate-plugin", "global-plugin-1"],
        }),
      )

      // kilocode_change - Local .kilo config with some overlapping plugins
      await Filesystem.write(
        path.join(opencodeDir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: ["duplicate-plugin", "local-plugin-1"],
        }),
      )
    },
  })

  await provideTestInstance({
    directory: path.join(tmp.path, "project"),
    fn: async (ctx) => {
      const config = await load(ctx)
      const plugins = config.plugin ?? []

      // Should contain all unique plugins
      expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("duplicate-plugin"))).toBe(true)

      // Should deduplicate the duplicate plugin
      const duplicatePlugins = plugins.filter((p) => p.includes("duplicate-plugin"))
      expect(duplicatePlugins.length).toBe(1)

      // Should have exactly 3 unique plugins
      const pluginNames = plugins.filter(
        (p) => p.includes("global-plugin") || p.includes("local-plugin") || p.includes("duplicate-plugin"),
      )
      expect(pluginNames.length).toBe(3)
    },
  })
})

test("keeps plugin origins aligned with merged plugin list", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const project = path.join(dir, "project")
      const local = path.join(project, ".kilo") // kilocode_change
      await fs.mkdir(local, { recursive: true })

      await Filesystem.write(
        path.join(dir, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: [["shared-plugin@1.0.0", { source: "global" }], "global-only@1.0.0"],
        }),
      )

      await Filesystem.write(
        path.join(local, "kilo.json"), // kilocode_change
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json", // kilocode_change
          plugin: [["shared-plugin@2.0.0", { source: "local" }], "local-only@1.0.0"],
        }),
      )
    },
  })

  await provideTestInstance({
    directory: path.join(tmp.path, "project"),
    fn: async (ctx) => {
      const cfg = await load(ctx)
      const plugins = cfg.plugin ?? []
      const origins = cfg.plugin_origins ?? []
      const names = plugins.map((item) => ConfigPlugin.pluginSpecifier(item))

      expect(names).toContain("shared-plugin@2.0.0")
      expect(names).not.toContain("shared-plugin@1.0.0")
      expect(names).toContain("global-only@1.0.0")
      expect(names).toContain("local-only@1.0.0")

      // kilocode_change start - bundled plugins intentionally have no external plugin origins
      expect(origins.map((item) => item.spec)).toEqual(
        plugins.filter((item) => !isIndexingPlugin(item) && !isAtomicChatPlugin(item)),
      )
      // kilocode_change end
      const hit = origins.find((item) => ConfigPlugin.pluginSpecifier(item.spec) === "shared-plugin@2.0.0")
      expect(hit?.scope).toBe("local")
    },
  })
})

// Legacy tools migration tests

it.instance("migrates legacy tools config to permissions - allow", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { bash: true, read: true } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({
      bash: "allow",
      read: "allow",
    })
  }),
)

it.instance("migrates legacy tools config to permissions - deny", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { bash: false, webfetch: false } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({
      bash: "deny",
      webfetch: "deny",
    })
  }),
)

it.instance("migrates legacy write tool to edit permission", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { write: true } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({ edit: "allow" })
  }),
)

// Managed settings tests
// kilocode_change - Note: preload.ts sets KILO_TEST_MANAGED_CONFIG which Global.Path.managedConfig uses

it.instance(
  "managed settings override user settings",
  Effect.gen(function* () {
    yield* writeManagedSettingsEffect({
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      model: "managed/model",
      share: "disabled",
    })

    const config = yield* Config.use.get()
    expect(config.model).toBe("managed/model")
    expect(config.share).toBe("disabled")
    expect(config.username).toBe("testuser")
  }),
  { config: { model: "user/model", share: "auto", username: "testuser" } },
)

it.instance(
  "managed settings override project settings",
  Effect.gen(function* () {
    yield* writeManagedSettingsEffect({
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      autoupdate: false,
      disabled_providers: ["openai"],
    })

    const config = yield* Config.use.get()
    expect(config.autoupdate).toBe(false)
    expect(config.disabled_providers).toEqual(["openai"])
  }),
  { config: { autoupdate: true, disabled_providers: [] } },
)

it.instance(
  "missing managed settings file is not an error",
  Effect.gen(function* () {
    const config = yield* Config.use.get()
    expect(config.model).toBe("user/model")
  }),
  { config: { model: "user/model" } },
)

it.instance("migrates legacy edit tool to edit permission", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { edit: false } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({ edit: "deny" })
  }),
)

it.instance("migrates legacy patch tool to edit permission", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { patch: true } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({ edit: "allow" })
  }),
)

it.instance("migrates mixed legacy tools config", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { tools: { bash: true, write: true, read: false, webfetch: true } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({
      bash: "allow",
      edit: "allow",
      read: "deny",
      webfetch: "allow",
    })
  }),
)

it.instance("merges legacy tools with existing permission config", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      agent: { test: { permission: { glob: "allow" }, tools: { bash: true } } },
    })

    const config = yield* Config.use.get()
    expect(config.agent?.["test"]?.permission).toEqual({
      glob: "allow",
      bash: "allow",
    })
  }),
)

it.instance("permission config preserves user key order", () =>
  // Permission precedence follows the order users write in config, so parsing
  // must not canonicalise known keys ahead of wildcard or custom keys.
  Effect.gen(function* () {
    const test = yield* TestInstance
    // kilocode_change start — isolate from global config to prevent cross-test contamination
    // (migrateBashPermission may write permission.bash to a global config file created by other
    // test files running in parallel, which mergeDeep then prepends to the project permission keys)
    const globalTmp = yield* tmpdirScoped()
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp
    // kilocode_change end
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        // kilocode_change start
        ;(Global.Path as { config: string }).config = prev
        yield* Config.use.invalidate()
        // kilocode_change end
      }),
    )
    yield* Config.use.invalidate()
    yield* writeConfigEffect(
      test.directory,
      {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        permission: {
          "*": "deny",
          edit: "ask",
          write: "ask",
          external_directory: "ask",
          read: "allow",
          todowrite: "allow",
          "thoughts_*": "allow",
          "reasoning_model_*": "allow",
          "tools_*": "allow",
          "pr_comments_*": "allow",
        },
      },
      "kilo.json", // kilocode_change
    )

    const config = yield* Config.use.get()
    expect(Object.keys(config.permission!)).toEqual([
      "*",
      "edit",
      "write",
      "external_directory",
      "read",
      "todowrite",
      "thoughts_*",
      "reasoning_model_*",
      "tools_*",
      "pr_comments_*",
    ])
  }),
)

test("config parser preserves permission order while rejecting unknown top-level keys", () => {
  const config = ConfigParse.schema(
    Config.Info,
    {
      permission: {
        bash: "allow",
        "*": "deny",
        edit: "ask",
      },
    },
    "test",
  )

  expect(Object.keys(config.permission!)).toEqual(["bash", "*", "edit"])
  try {
    ConfigParse.schema(Config.Info, { invalid_field: true }, "test")
    throw new Error("expected config parse to fail")
  } catch (err) {
    const error = err as { data?: { issues?: Array<{ code?: string; keys?: string[]; path?: string[] }> } }
    expect(error.data?.issues?.[0]).toMatchObject({ code: "unrecognized_keys", keys: ["invalid_field"], path: [] })
  }
})

// MCP config merging tests

// kilocode_change start - regression for `env` alias on local MCP entries
it.instance("local mcp accepts `env` as an alias for `environment`", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json",
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "@upstash/context7-mcp"],
          env: { CONTEXT7_API_KEY: "test-key" },
          enabled: true,
        },
      },
    })
    const config = yield* Config.use.get()
    expect(config.mcp?.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp"],
      environment: { CONTEXT7_API_KEY: "test-key" },
      enabled: true,
    })
  }),
)

it.instance("local mcp prefers `environment` over `env` when both are present", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json",
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "@upstash/context7-mcp"],
          environment: { CONTEXT7_API_KEY: "from-environment" },
          env: { CONTEXT7_API_KEY: "from-env" },
        },
      },
    })
    const config = yield* Config.use.get()
    expect(config.mcp?.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp"],
      environment: { CONTEXT7_API_KEY: "from-environment" },
    })
  }),
)
// kilocode_change end

it.instance("project config can override MCP server enabled status", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // kilocode_change - base config in .json, override in .jsonc (jsonc loads second and wins)
    // Simulates a base config (like from remote .well-known) with disabled MCP.
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      mcp: {
        jira: {
          type: "remote",
          url: "https://jira.example.com/mcp",
          enabled: false,
        },
        wiki: {
          type: "remote",
          url: "https://wiki.example.com/mcp",
          enabled: false,
        },
      },
    })
    // Project config enables just jira.
    yield* writeConfigEffect(
      test.directory,
      {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        mcp: {
          jira: {
            type: "remote",
            url: "https://jira.example.com/mcp",
            enabled: true,
          },
        },
      },
      "kilo.jsonc", // kilocode_change
    )

    const config = yield* Config.use.get()
    expect(config.mcp?.jira).toEqual({
      type: "remote",
      url: "https://jira.example.com/mcp",
      enabled: true,
    })
    expect(config.mcp?.wiki).toEqual({
      type: "remote",
      url: "https://wiki.example.com/mcp",
      enabled: false,
    })
  }),
)

it.instance("MCP config deep merges preserving base config properties", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // kilocode_change - base config in .json, override in .jsonc (jsonc loads second and wins)
    // kilocode_change - Base config with full MCP definition
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      mcp: {
        myserver: {
          type: "remote",
          url: "https://myserver.example.com/mcp",
          enabled: false,
          headers: {
            "X-Custom-Header": "value",
          },
        },
      },
    })
    // kilocode_change - Override just enables it, should preserve other properties
    yield* writeConfigEffect(
      test.directory,
      {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        mcp: {
          myserver: {
            type: "remote",
            url: "https://myserver.example.com/mcp",
            enabled: true,
          },
        },
      },
      "kilo.jsonc", // kilocode_change
    )

    const config = yield* Config.use.get()
    expect(config.mcp?.myserver).toEqual({
      type: "remote",
      url: "https://myserver.example.com/mcp",
      enabled: true,
      headers: {
        "X-Custom-Header": "value",
      },
    })
  }),
)

// kilocode_change start
it.instance("local .kilo config can override MCP from project config", () =>
  // kilocode_change end
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* writeConfigEffect(test.directory, {
      $schema: "https://app.kilo.ai/config.json", // kilocode_change
      mcp: {
        docs: {
          type: "remote",
          url: "https://docs.example.com/mcp",
          enabled: false,
        },
      },
    })
    yield* mkdirEffect(path.join(test.directory, ".kilo")) // kilocode_change
    yield* writeConfigEffect(
      path.join(test.directory, ".kilo"), // kilocode_change
      {
        $schema: "https://app.kilo.ai/config.json", // kilocode_change
        mcp: {
          docs: {
            type: "remote",
            url: "https://docs.example.com/mcp",
            enabled: true,
          },
        },
      },
      "kilo.json", // kilocode_change
    )

    const config = yield* Config.use.get()
    expect(config.mcp?.docs?.enabled).toBe(true)
  }),
)

test("project config overrides remote well-known config", async () => {
  const seen: { wellKnown?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      config: {
        mcp: { jira: { type: "remote", url: "https://jira.example.com/mcp", enabled: false } },
      },
    },
  })

  await provideTmpdirInstance(
    () =>
      Config.Service.use((svc) =>
        Effect.gen(function* () {
          const config = yield* svc.get()
          expect(seen.wellKnown).toBe("https://example.com/.well-known/opencode")
          expect(config.mcp?.jira?.enabled).toBe(true)
        }),
      ),
    {
      git: true,
      config: { mcp: { jira: { type: "remote", url: "https://jira.example.com/mcp", enabled: true } } },
    },
  ).pipe(
    Effect.scoped,
    Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com"), client })),
    Effect.runPromise,
  )
})

test("wellknown URL with trailing slash is normalized", async () => {
  const seen: { wellKnown?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      config: {
        mcp: { slack: { type: "remote", url: "https://slack.example.com/mcp", enabled: true } },
      },
    },
  })

  await provideTmpdirInstance(
    () =>
      Config.Service.use((svc) =>
        Effect.gen(function* () {
          yield* svc.get()
          expect(seen.wellKnown).toBe("https://example.com/.well-known/opencode")
        }),
      ),
    { git: true },
  ).pipe(
    Effect.scoped,
    Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com/"), client })),
    Effect.runPromise,
  )
})

test("remote well-known config can use FetchHttpClient layer", async () => {
  let fetchedUrl: string | undefined
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      fetchedUrl = request.url
      return new Response(
        JSON.stringify({
          config: {
            mcp: { jira: { type: "remote", url: "https://jira.example.com/mcp", enabled: true } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    },
  })

  try {
    await provideTmpdirInstance(
      () =>
        Config.Service.use((svc) =>
          Effect.gen(function* () {
            const config = yield* svc.get()
            expect(fetchedUrl).toBe(`${server.url.origin}/.well-known/opencode`)
            expect(config.mcp?.jira?.enabled).toBe(true)
          }),
        ),
      { git: true },
    ).pipe(
      Effect.scoped,
      Effect.provide(
        Config.layer.pipe(
          Layer.provide(testFlock),
          Layer.provide(AppFileSystem.defaultLayer),
          Layer.provide(Env.defaultLayer),
          Layer.provide(wellKnownAuth(server.url.origin)),
          Layer.provide(AccountTest.empty),
          Layer.provideMerge(infra),
          Layer.provide(NpmTest.noop),
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
      Effect.runPromise,
    )
  } finally {
    await server.stop(true)
  }
})

test("wellknown remote_config supports templated env vars in headers", async () => {
  const originalToken = process.env.TEST_TOKEN
  const seen: { wellKnown?: string; remote?: string; authorization?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      remote_config: {
        url: "https://config.example.com/opencode.json",
        headers: {
          Authorization: "Bearer {env:TEST_TOKEN}",
        },
      },
    },
    remote: {
      mcp: { confluence: { type: "remote", url: "https://confluence.example.com/mcp", enabled: true } },
    },
  })

  try {
    await provideTmpdirInstance(
      () =>
        Config.Service.use((svc) =>
          Effect.gen(function* () {
            const config = yield* svc.get()
            expect(seen.wellKnown).toBe("https://example.com/.well-known/opencode")
            expect(seen.remote).toBe("https://config.example.com/opencode.json")
            expect(seen.authorization).toBe("Bearer test-token")
            expect(config.mcp?.confluence?.enabled).toBe(true)
          }),
        ),
      { git: true },
    ).pipe(
      Effect.scoped,
      Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com"), client })),
      Effect.runPromise,
    )
  } finally {
    if (originalToken === undefined) delete process.env.TEST_TOKEN
    else process.env.TEST_TOKEN = originalToken
  }
})

test("wellknown token env substitution does not mutate process env", async () => {
  const originalToken = process.env.TEST_TOKEN
  process.env.TEST_TOKEN = "preexisting-token"
  const seen: { wellKnown?: string; remote?: string; authorization?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      remote_config: {
        url: "https://config.example.com/opencode.json",
        headers: {
          Authorization: "Bearer {env:TEST_TOKEN}",
        },
      },
    },
    remote: {
      mcp: { confluence: { type: "remote", url: "https://confluence.example.com/mcp", enabled: true } },
    },
  })

  try {
    const config = await provideTmpdirInstance(() => Config.Service.use((svc) => svc.get()), {
      git: true,
      config: { username: "{env:TEST_TOKEN}" },
    }).pipe(
      Effect.scoped,
      Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com"), client })),
      Effect.runPromise,
    )

    expect(seen.authorization).toBe("Bearer test-token")
    expect(config.username).toBe("test-token")
    expect(process.env.TEST_TOKEN).toBe("preexisting-token")
  } finally {
    if (originalToken === undefined) delete process.env.TEST_TOKEN
    else process.env.TEST_TOKEN = originalToken
  }
})

test("wellknown config null is treated as absent", async () => {
  const seen: { wellKnown?: string; remote?: string; authorization?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      config: null,
      remote_config: {
        url: "https://config.example.com/opencode.json",
      },
    },
    remote: {
      mcp: { confluence: { type: "remote", url: "https://confluence.example.com/mcp", enabled: true } },
    },
  })

  await provideTmpdirInstance(
    () =>
      Config.Service.use((svc) =>
        Effect.gen(function* () {
          const config = yield* svc.get()
          expect(seen.remote).toBe("https://config.example.com/opencode.json")
          expect(config.mcp?.confluence?.enabled).toBe(true)
        }),
      ),
    { git: true },
  ).pipe(
    Effect.scoped,
    Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com"), client })),
    Effect.runPromise,
  )
})

test("wellknown remote_config rejects non-object config responses", async () => {
  const seen: { wellKnown?: string; remote?: string; authorization?: string } = {}
  const client = remoteConfigClient({
    seen,
    wellKnown: {
      remote_config: {
        url: "https://config.example.com/opencode.json",
      },
    },
    remote: "not an object",
  })

  const exit = await provideTmpdirInstance(() => Config.Service.use((svc) => svc.get()).pipe(Effect.exit), {
    git: true,
  }).pipe(
    Effect.scoped,
    Effect.provide(configLayer({ auth: wellKnownAuth("https://example.com"), client })),
    Effect.runPromise,
  )

  expect(seen.remote).toBe("https://config.example.com/opencode.json")
  expect(Exit.isFailure(exit)).toBe(true)
})

describe("resolvePluginSpec", () => {
  test("keeps package specs unchanged", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.json") // kilocode_change
    expect(await ConfigPlugin.resolvePluginSpec("oh-my-opencode@2.4.3", file)).toBe("oh-my-opencode@2.4.3")
    expect(await ConfigPlugin.resolvePluginSpec("@scope/pkg", file)).toBe("@scope/pkg")
  })

  test("resolves windows-style relative plugin directory specs", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec(".\\plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin", "index.ts")).href)
  })

  test("resolves relative file plugin paths to file urls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "plugin.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "kilo.json") // kilocode_change
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin.ts", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin.ts")).href)
  })

  test("resolves plugin directory paths to directory urls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.writeJson(path.join(plugin, "package.json"), {
          name: "demo-plugin",
          type: "module",
          main: "./index.ts",
        })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "kilo.json") // kilocode_change
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin")).href)
  })

  test("resolves plugin directories without package.json to index.ts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin", "index.ts")).href)
  })
})

describe("deduplicatePluginOrigins", () => {
  const dedupe = (plugins: ConfigPlugin.Spec[]) =>
    ConfigPlugin.deduplicatePluginOrigins(
      plugins.map((spec) => ({
        spec,
        source: "",
        scope: "global" as const,
      })),
    ).map((item) => item.spec)

  test("removes duplicates keeping higher priority (later entries)", () => {
    const plugins = ["global-plugin@1.0.0", "shared-plugin@1.0.0", "local-plugin@2.0.0", "shared-plugin@2.0.0"]

    const result = dedupe(plugins)

    expect(result).toContain("global-plugin@1.0.0")
    expect(result).toContain("local-plugin@2.0.0")
    expect(result).toContain("shared-plugin@2.0.0")
    expect(result).not.toContain("shared-plugin@1.0.0")
    expect(result.length).toBe(3)
  })

  test("keeps path plugins separate from package plugins", () => {
    const plugins = ["oh-my-opencode@2.4.3", "file:///project/.kilo/plugin/oh-my-opencode.js"] // kilocode_change

    const result = dedupe(plugins)

    expect(result).toEqual(plugins)
  })

  test("deduplicates direct path plugins by exact spec", () => {
    const plugins = ["file:///project/.kilo/plugin/demo.ts", "file:///project/.kilo/plugin/demo.ts"] // kilocode_change

    const result = dedupe(plugins)

    expect(result).toEqual(["file:///project/.kilo/plugin/demo.ts"]) // kilocode_change
  })

  test("preserves order of remaining plugins", () => {
    const plugins = ["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"]

    const result = dedupe(plugins)

    expect(result).toEqual(["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"])
  })

  test("loads auto-discovered local plugins as file urls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const projectDir = path.join(dir, "project")
        const opencodeDir = path.join(projectDir, ".kilo") // kilocode_change
        const pluginDir = path.join(opencodeDir, "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Filesystem.write(
          path.join(dir, "kilo.json"), // kilocode_change
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json", // kilocode_change
            plugin: ["my-plugin@1.0.0"],
          }),
        )

        await Filesystem.write(path.join(pluginDir, "my-plugin.js"), "export default {}")
      },
    })

    await provideTestInstance({
      directory: path.join(tmp.path, "project"),
      fn: async (ctx) => {
        const config = await load(ctx)
        const plugins = config.plugin ?? []

        expect(plugins.some((p) => ConfigPlugin.pluginSpecifier(p) === "my-plugin@1.0.0")).toBe(true)
        expect(plugins.some((p) => ConfigPlugin.pluginSpecifier(p).startsWith("file://"))).toBe(true)
      },
    })
  })
})

describe("KILO_DISABLE_PROJECT_CONFIG", () => {
  it.instance("skips project config files when flag is set", () =>
    withProcessEnv(
      "KILO_DISABLE_PROJECT_CONFIG",
      "true",
      Effect.gen(function* () {
        const test = yield* TestInstance
        // kilocode_change start
        yield* writeConfigEffect(test.directory, {
          $schema: "https://app.kilo.ai/config.json",
          model: "project/model",
          username: "project-user",
        })
        // kilocode_change end
        const config = yield* Config.use.get()
        expect(config.model).not.toBe("project/model")
        expect(config.username).not.toBe("project-user")
      }),
    ),
  )

  // kilocode_change start
  it.instance("skips project .kilo/ directories when flag is set", () =>
    // kilocode_change end
    withProcessEnv(
      "KILO_DISABLE_PROJECT_CONFIG",
      "true",
      Effect.gen(function* () {
        const test = yield* TestInstance
        // kilocode_change - test .kilo/ directory (the test body writes to .kilo/command/)
        yield* mkdirEffect(path.join(test.directory, ".kilo", "command")) // kilocode_change
        yield* writeTextEffect(
          path.join(test.directory, ".kilo", "command", "test-cmd.md"), // kilocode_change
          "# Test Command\nThis is a test command.",
        )
        const directories = yield* Config.use.directories()
        // kilocode_change - Project .kilo should NOT be in directories list
        expect(directories.some((d) => d.startsWith(test.directory))).toBe(false)
      }),
    ),
  )

  it.instance("still loads global config when flag is set", () =>
    withProcessEnv(
      "KILO_DISABLE_PROJECT_CONFIG",
      "true",
      Effect.gen(function* () {
        const config = yield* Config.use.get()
        expect(config).toBeDefined()
        expect(config.username).toBeDefined()
      }),
    ),
  )

  it.instance(
    "skips relative instructions with warning when flag is set but no config dir",
    () =>
      withProcessEnvs(
        { KILO_CONFIG_DIR: undefined, KILO_DISABLE_PROJECT_CONFIG: "true" },
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* writeTextEffect(path.join(test.directory, "CUSTOM.md"), "# Custom Instructions")
          // The relative instruction should be skipped without error
          const config = yield* Config.use.get()
          expect(config).toBeDefined()
        }),
      ),
    { config: { instructions: ["./CUSTOM.md"] } },
  )

  it.instance(
    "KILO_CONFIG_DIR still works when flag is set",
    () =>
      Effect.gen(function* () {
        const configDir = yield* tmpdirScoped()
        // kilocode_change start
        yield* writeConfigEffect(configDir, {
          $schema: "https://app.kilo.ai/config.json",
          model: "configdir/model",
        })
        // kilocode_change end
        yield* withProcessEnvs(
          { KILO_DISABLE_PROJECT_CONFIG: "true", KILO_CONFIG_DIR: configDir },
          Effect.gen(function* () {
            const config = yield* Config.use.get()
            expect(config.model).toBe("configdir/model")
          }),
        )
      }),
    { config: { model: "project/model" } },
  )
})

// Regression for #28206: malformed KILO_PERMISSION JSON used to crash
// the app on startup with an unhandled SyntaxError. Loading the config with
// an invalid JSON value in this env var should not throw.
describe("KILO_PERMISSION env var", () => {
  it.instance("does not crash when KILO_PERMISSION contains invalid JSON", () =>
    withProcessEnv(
      "KILO_PERMISSION",
      "{invalid",
      Effect.gen(function* () {
        const config = yield* Config.use.get()
        // Regression: load() used to throw before returning anything.
        expect(config).toBeDefined()
      }),
    ),
  )
})

describe("KILO_CONFIG_CONTENT token substitution", () => {
  it.instance("substitutes {env:} tokens in KILO_CONFIG_CONTENT", () =>
    withProcessEnv(
      "TEST_CONFIG_VAR",
      "test_api_key_12345",
      withProcessEnv(
        "KILO_CONFIG_CONTENT",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          username: "{env:TEST_CONFIG_VAR}",
        }),
        Effect.gen(function* () {
          const config = yield* Config.use.get()
          expect(config.username).toBe("test_api_key_12345")
        }),
      ),
    ),
  )

  it.instance("substitutes {file:} tokens in KILO_CONFIG_CONTENT", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTextEffect(path.join(test.directory, "api_key.txt"), "secret_key_from_file")
      yield* withProcessEnv(
        "KILO_CONFIG_CONTENT",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          username: "{file:./api_key.txt}",
        }),
        Effect.gen(function* () {
          const config = yield* Config.use.get()
          expect(config.username).toBe("secret_key_from_file")
        }),
      )
    }),
  )
})

// parseManagedPlist unit tests — pure function, no OS interaction

test("parseManagedPlist strips MDM metadata keys", async () => {
  const config = ConfigParse.schema(
    Config.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          PayloadDisplayName: "OpenCode Managed",
          PayloadIdentifier: "ai.opencode.managed.test",
          PayloadType: "ai.opencode.managed",
          PayloadUUID: "AAAA-BBBB-CCCC",
          PayloadVersion: 1,
          _manualProfile: true,
          share: "disabled",
          model: "mdm/model",
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.share).toBe("disabled")
  expect(config.model).toBe("mdm/model")
  // MDM keys must not leak into the parsed config
  expect((config as any).PayloadUUID).toBeUndefined()
  expect((config as any).PayloadType).toBeUndefined()
  expect((config as any)._manualProfile).toBeUndefined()
})

test("parseManagedPlist parses server settings", async () => {
  const config = ConfigParse.schema(
    Config.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          server: { hostname: "127.0.0.1", mdns: false },
          autoupdate: true,
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.server?.hostname).toBe("127.0.0.1")
  expect(config.server?.mdns).toBe(false)
  expect(config.autoupdate).toBe(true)
})

test("parseManagedPlist parses permission rules", async () => {
  const config = ConfigParse.schema(
    Config.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: {
            "*": "ask",
            bash: { "*": "ask", "rm -rf *": "deny", "curl *": "deny" },
            grep: "allow",
            glob: "allow",
            webfetch: "ask",
            "~/.ssh/*": "deny",
          },
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.permission?.["*"]).toBe("ask")
  expect(config.permission?.grep).toBe("allow")
  expect(config.permission?.webfetch).toBe("ask")
  expect(config.permission?.["~/.ssh/*"]).toBe("deny")
  const bash = config.permission?.bash as Record<string, string>
  expect(bash?.["rm -rf *"]).toBe("deny")
  expect(bash?.["curl *"]).toBe("deny")
})

test("parseManagedPlist parses enabled_providers", async () => {
  const config = ConfigParse.schema(
    Config.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: ["anthropic", "google"],
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.enabled_providers).toEqual(["anthropic", "google"])
})

test("parseManagedPlist handles empty config", async () => {
  const config = ConfigParse.schema(
    Config.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(JSON.stringify({ $schema: "https://opencode.ai/config.json" })),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.$schema).toBe("https://opencode.ai/config.json")
})
