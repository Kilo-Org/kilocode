import { Bus } from "@/bus"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { VtScreen } from "@/kilocode/cli/cmd/tui/vt/vt-screen"
import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { Instance, capture, type InstanceContext } from "@/kilocode/instance"
import { InteractiveTerminalTool } from "@/kilocode/tool/interactive-terminal"
import { Plugin } from "@/plugin"
import type { Permission } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import { Shell } from "@opencode-ai/core/shell"
import { Truncate } from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { it, testEffect } from "../lib/effect"

const toolLayer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  FSUtil.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
)
const toolIt = testEffect(toolLayer)

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string, name: string, source: string) {
  const file = path.join(dir, name)
  await Bun.write(file, source)
  const bin = quote(process.execPath)
  const arg = quote(file)
  if (Shell.ps(Shell.acceptable())) return `& ${bin} ${arg}`
  return `${bin} ${arg}`
}

function started(sessionID: SessionID) {
  const state: { off?: () => void; timer?: ReturnType<typeof setTimeout> } = {}
  const promise = new Promise<InteractiveTerminal.Info>((resolve, reject) => {
    state.timer = setTimeout(() => {
      state.off?.()
      reject(new Error("timed out waiting for interactive terminal"))
    }, 5_000)
    state.off = Bus.subscribe(InteractiveTerminal.Event.Updated, (event) => {
      const info = event.properties.info
      if (info.sessionID !== sessionID || info.status !== "running") return
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
      resolve(info)
    })
  })
  return {
    promise,
    dispose() {
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
    },
  }
}

function emitted(id: InteractiveTerminal.ID, expected: string) {
  const state: { off?: () => void; timer?: ReturnType<typeof setTimeout> } = {}
  const promise = new Promise<string>((resolve, reject) => {
    state.timer = setTimeout(() => {
      state.off?.()
      reject(new Error(`timed out waiting for terminal output: ${expected}`))
    }, 5_000)
    state.off = Bus.subscribe(InteractiveTerminal.Event.Data, (event) => {
      if (event.properties.terminalID !== id || !event.properties.data.includes(expected)) return
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
      resolve(event.properties.data)
    })
  })
  return {
    promise,
    dispose() {
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
    },
  }
}

async function snapshot(ctx: InstanceContext, id: InteractiveTerminal.ID, expected: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = await Instance.restore(ctx, () => InteractiveTerminal.get(id))
    if (value?.output.includes(expected)) return value
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for terminal snapshot: ${expected}`)
}

function run(input: { sessionID: SessionID; command: string; cwd: string; abort?: AbortSignal }) {
  return InteractiveTerminal.run({
    ...input,
    shell: Shell.acceptable(),
    env: { ...process.env },
  })
}

function context(
  requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>,
  stop?: { permission: string; error: Error },
): Tool.Context {
  return {
    sessionID: SessionID.make("ses_terminal_tool"),
    messageID: MessageID.make("msg_terminal_tool"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (request) =>
      Effect.sync(() => {
        requests.push(request)
        if (stop?.permission === request.permission) throw stop.error
      }),
  }
}

const initTool = Effect.fn("InteractiveTerminalToolTest.init")(function* () {
  const info = yield* InteractiveTerminalTool
  return yield* info.init()
})

const failTool = Effect.fn("InteractiveTerminalToolTest.fail")(function* (
  args: { command: string; workdir?: string; description?: string },
  ctx: Tool.Context,
) {
  const tool = yield* initTool()
  const exit = yield* tool.execute(args, ctx).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected terminal tool to stop before launch")
})

describe("InteractiveTerminal", () => {
  toolIt.instance("asks for external_directory paths referenced inside the command", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp, "secret.txt")
      yield* Effect.promise(() => Bun.write(file, "secret"))
      const err = new Error("stop before terminal launch")
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      expect(
        yield* failTool({ command: `cat ${quote(file)}` }, context(requests, { permission: "bash", error: err })),
      ).toMatchObject({ message: err.message })
      const ext = requests.find((item) => item.permission === "external_directory")
      const bash = requests.find((item) => item.permission === "bash")
      const want =
        process.platform === "win32" ? FSUtil.normalizePathPattern(path.join(tmp, "*")) : path.join(tmp, "*")
      expect(ext?.patterns).toContain(want)
      expect(bash?.patterns).toContain(`cat ${quote(file)}`)
    }),
  )

  toolIt.instance("uses bash arity for persisted interactive command approvals", () =>
    Effect.gen(function* () {
      const err = new Error("stop before terminal launch")
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      expect(
        yield* failTool(
          { command: "gh auth login", description: "Log in to GitHub" },
          context(requests, { permission: "bash", error: err }),
        ),
      ).toMatchObject({ message: err.message })
      const bash = requests.find((item) => item.permission === "bash")
      expect(bash?.always).toContain("gh auth login *")
      expect(bash?.always).not.toContain("gh *")
    }),
  )

  it.instance("runs commands in a real TTY and captures output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "tty.mjs",
          `console.log(process.stdin.isTTY && process.stdout.isTTY ? "TTY" : "NOTTY")\n`,
        ),
      )
      const result = yield* Effect.promise(() => run({ sessionID, command, cwd: test.directory }))
      expect(result.closedBy).toBe("exit")
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("TTY")
      expect(result.output).not.toContain("NOTTY")
    }),
  )

  it.instance("accepts human input and returns the resulting output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "input.mjs",
          `process.stdin.setEncoding("utf8")
console.log("READY")
process.stdin.once("data", (data) => {
  console.log("INPUT:" + data.trim())
  process.exit(0)
})
`,
        ),
      )
      const ready = started(sessionID)
      try {
        const pending = run({ sessionID, command, cwd: test.directory })
        const info = yield* Effect.promise(() => ready.promise)
        const wrote = yield* Effect.promise(() => InteractiveTerminal.write(info.id, "hello\r"))
        expect(wrote).toBe(true)
        const result = yield* Effect.promise(() => pending)
        expect(result.closedBy).toBe("exit")
        expect(result.output).toContain("READY")
        expect(result.output).toContain("INPUT:hello")
      } finally {
        ready.dispose()
        yield* Effect.promise(() => InteractiveTerminal.stopSession(sessionID))
      }
    }),
  )

  it.instance("streams terminal echo before enter", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "echo.mjs",
          `process.stdin.setEncoding("utf8")
console.log("READY")
process.stdin.once("data", () => process.exit(0))
`,
        ),
      )
      const ready = started(sessionID)
      const ctx = capture()!
      const streams: Array<{ dispose(): void }> = []
      try {
        const pending = run({ sessionID, command, cwd: test.directory })
        const info = yield* Effect.promise(() => ready.promise)
        const output = emitted(info.id, "x")
        streams.push(output)
        yield* Effect.promise(() => InteractiveTerminal.write(info.id, "x"))
        expect(yield* Effect.promise(() => output.promise)).toContain("x")
        const retained = yield* Effect.promise(() => snapshot(ctx, info.id, "READY"))
        const screen = new VtScreen(100, 18)
        screen.write(retained.output)
        expect(screen.text()).toContain("READY")
        expect(screen.text()).toContain("x")
        yield* Effect.promise(() => InteractiveTerminal.write(info.id, "\r"))
        yield* Effect.promise(() => pending)
      } finally {
        ready.dispose()
        streams.forEach((stream) => stream.dispose())
        yield* Effect.promise(() => InteractiveTerminal.stopSession(sessionID))
      }
    }),
  )

  it.instance("user close terminates the PTY and unblocks the run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(test.directory, "wait.mjs", `console.log("WAITING")\nsetInterval(() => {}, 1_000)\n`),
      )
      const ready = started(sessionID)
      try {
        const pending = run({ sessionID, command, cwd: test.directory })
        const info = yield* Effect.promise(() => ready.promise)
        const closed = yield* Effect.promise(() => InteractiveTerminal.close(info.id))
        expect(closed).toBe(true)
        const result = yield* Effect.promise(() => pending)
        expect(result.closedBy).toBe("user")
        const list = yield* Effect.promise(() => InteractiveTerminal.list({ sessionID }))
        expect(list).toEqual([])
      } finally {
        ready.dispose()
        yield* Effect.promise(() => InteractiveTerminal.stopSession(sessionID))
      }
    }),
  )

  it.instance("abort closes the PTY and unblocks the run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() => script(test.directory, "abort.mjs", `setInterval(() => {}, 1_000)\n`))
      const controller = new AbortController()
      const ready = started(sessionID)
      try {
        const pending = run({ sessionID, command, cwd: test.directory, abort: controller.signal })
        yield* Effect.promise(() => ready.promise)
        controller.abort()
        const result = yield* Effect.promise(() => pending)
        expect(result.closedBy).toBe("abort")
      } finally {
        ready.dispose()
        yield* Effect.promise(() => InteractiveTerminal.stopSession(sessionID))
      }
    }),
  )
})
