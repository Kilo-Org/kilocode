import { expect, test } from "bun:test"
import { Shell } from "@opencode-ai/core/shell"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Exit, Layer } from "effect"
import path from "node:path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundProcess } from "@/kilocode/background-process"
import { SkillInject } from "@/kilocode/skills/inject"
import { BackgroundProcessTool } from "@/kilocode/tool/background-process"
import { Plugin } from "@/plugin"
import { MessageID, SessionID } from "@/session/schema"
import { classifyShell, ShellPermission, ShellTool } from "@/tool/shell"
import type { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { TestInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const cases = [
  {
    shell: "bash",
    script: "printf ready | grep ready; cd .",
    commands: ["printf ready", "grep ready", "cd ."],
    uncertain: true,
  },
  { shell: "bash", script: "printf ready | grep ready", commands: ["printf ready", "grep ready"], uncertain: false },
  { shell: "bash", script: "cd .", commands: ["cd ."], uncertain: false },
  {
    shell: "bash",
    script: "printf $(printf nested); echo ready",
    commands: ["printf nested", "printf $(printf nested)", "echo ready"],
    uncertain: true,
  },
  {
    shell: "pwsh",
    script: "Write-Output 'hello world' | Write-Output",
    commands: ["Write-Output 'hello world'", "Write-Output"],
    uncertain: false,
  },
  {
    shell: "pwsh",
    script: "Write-Output ready; Write-Output hello -- value",
    commands: ["Write-Output ready"],
    uncertain: true,
  },
  {
    shell: "powershell",
    script: "Write-Output $(Write-Output nested)",
    commands: ["Write-Output nested", "Write-Output $(Write-Output nested)"],
    uncertain: true,
  },
  { shell: "zsh", script: "printf ready", commands: [], uncertain: true },
]

test.each(cases)(
  "classifies $shell with conservative coverage: $script",
  async ({ shell, script, commands, uncertain }) => {
    const result = await Effect.runPromise(classifyShell(script, shell))
    expect(result.managedShell).toEqual({
      kind: shell === "bash" ? "bash" : shell === "zsh" ? "unsupported" : "powershell",
      commands,
      uncertain,
    })
  },
)

test.each([
  ["bash", "printf ready > ../note.txt"],
  ["pwsh", "Write-Output ready > ../note.txt"],
])("retains a static file destination independently: %s", async (shell, script) => {
  const scan = await Effect.runPromise(classifyShell(script, shell))
  expect([...scan.paths]).toEqual(["../note.txt"])
  expect(scan.managedShell.uncertain).toBe(true)
})

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        CrossSpawnSpawner.node,
        FSUtil.node,
        Plugin.node,
        Truncate.node,
        Config.node,
        Agent.node,
        RuntimeFlags.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

type Request = Parameters<Tool.Context["ask"]>[0]

function context(asks: Request[], events: string[]) {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.make("msg_managed_shell"),
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) => Effect.sync(() => void (asks.push(req), events.push(req.permission))),
    recheck: () =>
      Effect.sync(() => {
        events.push("recheck")
        throw new Error("authorization changed")
      }),
  } satisfies Tool.Context
}

const bash = Bun.which("bash") ?? Shell.gitbash()
const pwsh = Bun.which("pwsh") ?? Bun.which("powershell") ?? undefined

for (const [shell, kind, script] of [
  [bash, "bash", "printf approved > marker.txt"],
  [pwsh, "powershell", "Write-Output approved > marker.txt"],
] as const) {
  const run = shell ? it.instance : it.instance.skip
  run(
    `rechecks ${kind} after the external directory approval and before a real spawn`,
    () =>
      Effect.gen(function* () {
        const outside = yield* tmpdirScoped()
        const apps = yield* ShellTool
        const tool = yield* apps.init()
        const requests: Request[] = []
        const events: string[] = []
        const ctx = context(requests, events)
        const args = { command: script, workdir: outside }
        const result = yield* tool.execute(args, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(events).toEqual(["external_directory", "bash", "recheck"])
        expect(requests.at(1)?.managedShell?.kind).toBe(kind)
        const marker = path.join(outside, "marker.txt")
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)

        const ok = yield* tool.execute(args, { ...ctx, recheck: () => Effect.void })
        expect(ok.metadata.exit).toBe(0)
        expect(yield* Effect.promise(() => Bun.file(marker).text())).toContain("approved")
      }),
    { git: true, config: { shell } },
  )
}

const unix = process.platform !== "win32" && bash ? it.instance : it.instance.skip

unix(
  "rechecks the full shell operation after sandbox escalation",
  () =>
    Effect.gen(function* () {
      const inst = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(inst.directory, "note.txt"), "hello"))
      const tool = yield* (yield* ShellTool).init()
      const events: string[] = []
      const result = yield* tool
        .execute(
          { command: "git add note.txt; printf ok > marker.txt" },
          { ...context([], events), extra: { sandboxed: true } },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(events).toEqual(["bash", "sandbox_escalation", "recheck"])
      expect(yield* Effect.promise(() => Bun.file(path.join(inst.directory, "marker.txt")).exists())).toBe(false)
    }),
  { git: true, config: { shell: bash } },
)

unix("rechecks a skill batch before each approved command", () =>
  Effect.gen(function* () {
    const inst = yield* TestInstance
    const scan = yield* ShellPermission
    const requests: Request[] = []
    const events: string[] = []
    const ctx = context(requests, events)
    const result = yield* SkillInject.render({
      shell: bash ?? "bash",
      cwd: inst.directory,
      content: "!`printf first > first.txt` !`printf second > second.txt`",
      trusted: true,
      disabled: false,
      skill: "example",
      ctx: {
        ...ctx,
        recheck: () =>
          events.includes("first recheck") ? ctx.recheck() : Effect.sync(() => void events.push("first recheck")),
      },
      decompose: scan.decompose,
    }).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(events).toEqual(["bash", "first recheck", "recheck"])
    expect(requests.at(0)?.managedShell).toEqual({
      kind: "bash",
      commands: ["printf first", "printf second"],
      uncertain: true,
    })
    expect(yield* Effect.promise(() => Bun.file(path.join(inst.directory, "first.txt")).text())).toBe("first")
    expect(yield* Effect.promise(() => Bun.file(path.join(inst.directory, "second.txt")).exists())).toBe(false)
  }),
)

unix("rechecks a model-driven background launch before spawning", () =>
  Effect.gen(function* () {
    const inst = yield* TestInstance
    const tool = yield* (yield* BackgroundProcessTool).init()
    const requests: Request[] = []
    const events: string[] = []
    const ctx = context(requests, events)
    const result = yield* tool.execute({ action: "start", command: "printf ready > marker.txt" }, ctx).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(events).toEqual(["bash", "recheck"])
    expect(requests.at(0)?.managedShell?.uncertain).toBe(true)
    expect(yield* Effect.promise(() => BackgroundProcess.list({ sessionID: ctx.sessionID }))).toEqual([])
    expect(yield* Effect.promise(() => Bun.file(path.join(inst.directory, "marker.txt")).exists())).toBe(false)
  }),
)

unix(
  "a refused model-driven restart leaves the existing background process running",
  () =>
    Effect.gen(function* () {
      const inst = yield* TestInstance
      const tool = yield* (yield* BackgroundProcessTool).init()
      const asks: Request[] = []
      const events: string[] = []
      const ctx = context(asks, events)
      const info = yield* Effect.promise(() =>
        BackgroundProcess.start(
          {
            sessionID: ctx.sessionID,
            command: "printf 'ready\\n'; sleep 30",
            cwd: inst.directory,
            ready: { pattern: "ready" },
          },
          { shell: bash ?? "bash" },
        ),
      )
      try {
        const result = yield* tool.execute({ action: "restart", id: info.id }, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(events).toEqual(["bash", "recheck"])
        expect(asks.at(0)).toMatchObject({ managedOnly: true, managedShell: { uncertain: true } })
        const current = yield* Effect.promise(() => BackgroundProcess.get(info.id))
        expect(current).toMatchObject({ pid: info.pid, status: "ready" })
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stop(info.id))
      }
    }),
  20_000,
)
