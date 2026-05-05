import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { Instance } from "../../../src/project/instance"
import { MessageID, SessionID } from "../../../src/session/schema"
import { Shell } from "../../../src/shell/shell"
import { Truncate } from "../../../src/tool/truncate"
import { BashTool } from "../../../src/tool/bash"
import { Plugin } from "../../../src/plugin"
import { tmpdir } from "../../fixture/fixture"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Config.defaultLayer,
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

const init = () => runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
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

async function reject() {
  const requests = await Permission.list()
  for (const req of requests) {
    await Permission.reply({ requestID: req.id, reply: "reject" })
  }
}

async function immediate(pending: Promise<void>) {
  try {
    await Promise.race([
      pending,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out waiting for permission to resolve")), 500),
      ),
    ])
  } finally {
    const requests = await Permission.list()
    if (requests.length > 0) {
      await reject()
      await pending.catch(() => undefined)
    }
  }
  expect(await Permission.list()).toHaveLength(0)
}

async function wait(count: number) {
  for (const _ of Array.from({ length: 500 })) {
    const list = await Permission.list()
    if (list.length === count) return list
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${count} pending permission request(s)`)
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("external_directory allow config protection", () => {
  test("allows file-tool external_directory requests for global config paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await immediate(
          Permission.ask({
            id: PermissionID.make("permission_file_external_read"),
            sessionID: SessionID.make("session_file_external_read"),
            permission: "external_directory",
            patterns: [configGlob],
            metadata: { filepath: configFile, parentDir: config },
            always: [configGlob],
            ruleset,
          }),
        )
      },
    })
  })

  test("allows read-only bash external_directory requests for global config paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await immediate(
          Permission.ask({
            id: PermissionID.make("permission_bash_external_read"),
            sessionID: SessionID.make("session_bash_external_read"),
            permission: "external_directory",
            patterns: [configGlob],
            metadata: { command: `cat ${quote(configFile)}`, access: "read" },
            always: [configGlob],
            ruleset,
          }),
        )
      },
    })
  })

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

  test("keeps unknown bash external_directory requests for global config paths protected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pending = Permission.ask({
          id: PermissionID.make("permission_bash_external_write"),
          sessionID: SessionID.make("session_bash_external_write"),
          permission: "external_directory",
          patterns: [configGlob],
          metadata: { command: `rm ${quote(configFile)}` },
          always: [configGlob],
          ruleset,
        })

        const requests = await wait(1)
        expect(requests[0]).toMatchObject({
          id: PermissionID.make("permission_bash_external_write"),
          permission: "external_directory",
          metadata: { disableAlways: true },
        })

        await Permission.reply({ requestID: PermissionID.make("permission_bash_external_write"), reply: "reject" })
        await expect(pending).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })
})

describe("bash external_directory access metadata", () => {
  test("emits read access metadata for cat external files", async () => {
    await using outer = await tmpdir({ init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello") })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
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
        await Instance.provide({
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
    await Instance.provide({
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
    await Instance.provide({
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
