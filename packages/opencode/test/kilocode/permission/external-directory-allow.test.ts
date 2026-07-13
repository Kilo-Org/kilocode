import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Agent } from "../../../src/agent/agent"
import { Bus } from "../../../src/bus"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { provideTestInstance } from "../../fixture/fixture"
import { MessageID, SessionID } from "../../../src/session/schema"
import { Shell } from "../../../src/shell/shell"
import { Truncate } from "../../../src/tool/truncate"
import { ShellTool } from "../../../src/tool/shell"
import { Plugin } from "../../../src/plugin"
import { disposeAllInstances, provideTmpdirInstance, tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { KilocodePaths } from "../../../src/kilocode/paths"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_external_directory_allow"),
  messageID: MessageID.make("msg_external_directory_allow"),
  callID: "call_external_directory_allow",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const ruleset: Permission.Ruleset = [{ permission: "external_directory", pattern: "*", action: "allow" }]
const psNames = new Set(["powershell", "pwsh"])
const ps =
  process.platform === "win32"
    ? [Bun.which("pwsh"), Bun.which("powershell")]
        .filter((shell): shell is string => Boolean(shell))
        .map((shell) => ({ label: Shell.name(shell), shell }))
        .filter((item) => psNames.has(item.label))
    : []

Shell.acceptable.reset()

const init = () => runtime.runPromise(ShellTool.pipe(Effect.flatMap((info) => info.init())))
const quote = (text: string) => `"${text.replaceAll('"', '\\"')}"`
const glob = (file: string) =>
  process.platform === "win32" ? AppFileSystem.normalizePathPattern(file) : file.replaceAll("\\", "/")
const variants = (dir: string) => {
  if (process.platform !== "win32") return [dir]
  const full = AppFileSystem.normalizePath(dir)
  const slash = full.replaceAll("\\", "/")
  const root = slash.replace(/^[A-Za-z]:/, "")
  return Array.from(new Set([full, slash, root, root.toLowerCase()]))
}
const config = path.resolve(Global.Path.config)
const configFile = path.join(config, "hello.txt")
const configGlob = glob(path.join(config, "*"))
const bus = Bus.layer
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus), Layer.provide(Config.defaultLayer)),
  bus,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const ask = (input: Permission.AskInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Permission.ReplyInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const saveAlwaysRules = (input: Parameters<Permission.Interface["saveAlwaysRules"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.saveAlwaysRules(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const capture = (requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>, stop?: Error) => ({
  ...ctx,
  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      requests.push(req)
      if (stop) throw stop
    }),
})

const withShell = (item: { shell: string }, fn: () => Promise<void>) => async () => {
  const prev = process.env.SHELL
  process.env.SHELL = item.shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

const reject = () =>
  Effect.gen(function* () {
    for (const req of yield* list()) {
      yield* reply({ requestID: req.id, reply: "reject" })
    }
  })

const immediate = (pending: Effect.Effect<void, Permission.Error, Permission.Service>) =>
  Effect.gen(function* () {
    const exit = yield* pending.pipe(Effect.timeout("2 seconds"), Effect.exit)
    if (Exit.isFailure(exit)) {
      const items = yield* list()
      if (items.length > 0) {
        yield* reject()
      }
      return yield* exit
    }
    expect(yield* list()).toHaveLength(0)
  })

const wait = (count: number) =>
  Effect.gen(function* () {
    for (const _ of Array.from({ length: 500 })) {
      const items = yield* list()
      if (items.length === count) return items
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

afterEach(async () => {
  await disposeAllInstances()
})

describe("external_directory allow config protection", () => {
  it.live("allows file-tool external_directory requests for global config paths", () =>
    provideTmpdirInstance(
      () =>
        immediate(
          ask({
            id: PermissionID.make("permission_file_external_read"),
            sessionID: SessionID.make("session_file_external_read"),
            permission: "external_directory",
            patterns: [configGlob],
            metadata: { filepath: configFile, parentDir: config },
            always: [configGlob],
            ruleset,
          }),
        ),
      { git: true },
    ),
  )

  it.live("allows read-only bash external_directory requests for global config paths", () =>
    provideTmpdirInstance(
      () =>
        immediate(
          ask({
            id: PermissionID.make("permission_bash_external_read"),
            sessionID: SessionID.make("session_bash_external_read"),
            permission: "external_directory",
            patterns: [configGlob],
            metadata: { command: `cat ${quote(configFile)}`, access: "read" },
            always: [configGlob],
            ruleset,
          }),
        ),
      { git: true },
    ),
  )

  for (const pattern of variants(configGlob)) {
    test(`detects unknown bash external_directory requests for global config paths [${pattern}]`, () => {
      expect(
        ConfigProtection.isRequest({
          permission: "external_directory",
          patterns: [pattern],
          metadata: { command: `rm ${quote(configFile)}` },
        }),
      ).toBe(true)
    })
  }

  it.live("keeps unknown bash external_directory requests for global config paths protected", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const pending = yield* ask({
            id: PermissionID.make("permission_bash_external_write"),
            sessionID: SessionID.make("session_bash_external_write"),
            permission: "external_directory",
            patterns: [configGlob],
            metadata: { command: `rm ${quote(configFile)}` },
            always: [configGlob],
            ruleset,
          }).pipe(Effect.forkScoped)

          const requests = yield* wait(1)
          expect(requests[0]).toMatchObject({
            id: PermissionID.make("permission_bash_external_write"),
            permission: "external_directory",
            metadata: { disableAlways: true, configProtected: true },
          })

          yield* reply({ requestID: PermissionID.make("permission_bash_external_write"), reply: "reject" })
          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )

  it.live("persists approval for one exact global skill directory", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const pattern = glob(path.join(KilocodePaths.globalDirs()[0], "skills", "axiom-sre", "*"))
          const input = {
            sessionID: SessionID.make("session_global_skill"),
            permission: "external_directory",
            patterns: [pattern],
            metadata: { command: "node scripts/query.mjs", rules: ["*"] },
            always: [pattern],
            ruleset,
          } as const
          const pending = yield* ask({
            ...input,
            id: PermissionID.make("permission_global_skill"),
          }).pipe(Effect.forkScoped)

          const requests = yield* wait(1)
          expect(requests[0]).toMatchObject({
            id: PermissionID.make("permission_global_skill"),
            permission: "external_directory",
            patterns: [pattern],
          })
          const always = (requests[0]?.always ?? []) as string[]
          expect(always).toHaveLength(1)
          expect(always[0]).toMatch(/skills\/axiom-sre\/\*$/)
          const rules = (requests[0]?.metadata?.rules ?? []) as string[]
          expect(rules).toHaveLength(1)
          expect(rules[0]).toMatch(/skills\/axiom-sre\/\*$/)
          expect(requests[0]?.metadata).not.toMatchObject({ disableAlways: true, configProtected: true })

          yield* reply({ requestID: PermissionID.make("permission_global_skill"), reply: "always" })
          yield* Fiber.join(pending)
          yield* immediate(ask(input))

          const sibling = glob(path.join(KilocodePaths.globalDirs()[0], "skills", "other", "*"))
          const next = yield* ask({
            ...input,
            id: PermissionID.make("permission_other_skill"),
            patterns: [sibling],
            always: [sibling],
          }).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toMatchObject([{ id: PermissionID.make("permission_other_skill") }])
          yield* reply({ requestID: PermissionID.make("permission_other_skill"), reply: "reject" })
          expect(Exit.isFailure(yield* Fiber.await(next))).toBe(true)
        }),
      { git: true },
    ),
  )

  it.live("limits selected approval rules to the exact global skill directory", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const pattern = glob(path.join(KilocodePaths.globalDirs()[0], "skills", "selected-skill", "*"))
          const id = PermissionID.make("permission_selected_skill")
          const input = {
            sessionID: SessionID.make("session_selected_skill"),
            permission: "external_directory",
            patterns: [pattern],
            metadata: { command: "node scripts/query.mjs", rules: ["*"] },
            always: ["*"],
            ruleset,
          } as const
          const pending = yield* ask({ ...input, id }).pipe(Effect.forkScoped)

          const reqs = yield* wait(1)
          expect(reqs[0]).toMatchObject({ id })
          const always = (reqs[0]?.always ?? []) as string[]
          expect(always).toHaveLength(1)
          expect(always[0]).toMatch(/skills\/selected-skill\/\*$/)
          const rules = (reqs[0]?.metadata?.rules ?? []) as string[]
          expect(rules).toHaveLength(1)
          expect(rules[0]).toMatch(/skills\/selected-skill\/\*$/)
          yield* saveAlwaysRules({ requestID: id, approvedAlways: ["*", rules[0]] })
          yield* reply({ requestID: id, reply: "once" })
          yield* Fiber.join(pending)
          yield* immediate(ask(input))
        }),
      { git: true },
    ),
  )
})

describe("bash external_directory access metadata", () => {
  test("emits read access metadata for cat external files", async () => {
    await using outer = await tmpdir({ init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello") })
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const bash = await init()
        const err = new Error("stop after external permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const file = path.join(outer.path, "hello.txt")
        const command = `cat ${quote(file)}`

        await expect(
          Effect.runPromise(bash.execute({ command, description: "Read external file" }, capture(requests, err))),
        ).rejects.toThrow(err.message)

        const req = requests.find((item) => item.permission === "external_directory")
        expect(req).toMatchObject({
          patterns: [glob(path.join(outer.path, "*"))],
          metadata: { command, access: "read" },
        })
      },
    })
  })

  for (const item of ps) {
    test(
      `emits read access metadata for Get-Content external files [${item.label}]`,
      withShell(item, async () => {
        await using outer = await tmpdir({ init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello") })
        await using tmp = await tmpdir({ git: true })
        await provideTestInstance({
          directory: tmp.path,
          fn: async () => {
            const bash = await init()
            const err = new Error("stop after external permission")
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            const file = path.join(outer.path, "hello.txt")
            const command = `Get-Content ${quote(file)}`

            await expect(
              Effect.runPromise(bash.execute({ command, description: "Read external file" }, capture(requests, err))),
            ).rejects.toThrow(err.message)

            const req = requests.find((item) => item.permission === "external_directory")
            expect(req).toMatchObject({
              patterns: [glob(path.join(outer.path, "*"))],
              metadata: { command, access: "read" },
            })
          },
        })
      }),
    )
  }

  test("does not emit read access metadata for mutating external file commands", async () => {
    await using outer = await tmpdir({ init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello") })
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const bash = await init()
        const file = path.join(outer.path, "hello.txt")
        const target = path.join(tmp.path, "target.txt")
        const commands = [
          `rm ${quote(file)}`,
          `mv ${quote(file)} ${quote(target)}`,
          `cp ${quote(file)} ${quote(target)}`,
          `touch ${quote(file)}`,
        ]

        for (const command of commands) {
          const err = new Error("stop after external permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          await expect(
            Effect.runPromise(bash.execute({ command, description: "Mutate external file" }, capture(requests, err))),
          ).rejects.toThrow(err.message)

          const req = requests.find((item) => item.permission === "external_directory")
          expect(req).toBeDefined()
          expect(req?.metadata).not.toMatchObject({ access: "read" })
        }
      },
    })
  })

  test("does not emit read access metadata for mixed read and write external commands", async () => {
    await using outer = await tmpdir({ init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello") })
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const bash = await init()
        const file = path.join(outer.path, "hello.txt")
        const commands = [`cat ${quote(file)} && rm ${quote(file)}`, `cat ${quote(file)} && printf x > ${quote(file)}`]

        for (const command of commands) {
          const err = new Error("stop after external permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []

          await expect(
            Effect.runPromise(
              bash.execute({ command, description: "Read then write external file" }, capture(requests, err)),
            ),
          ).rejects.toThrow(err.message)

          const req = requests.find((item) => item.permission === "external_directory")
          expect(req).toBeDefined()
          expect(req?.metadata).not.toMatchObject({ access: "read" })
        }
      },
    })
  })
})
