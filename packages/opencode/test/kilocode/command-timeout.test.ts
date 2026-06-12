import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import * as Sink from "effect/Sink"
import * as TestClock from "effect/testing/TestClock"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CommandTimeout } from "@/kilocode/command-timeout"
import { ShellTool } from "@/tool/shell"
import { Plugin } from "@/plugin"
import { Truncate } from "@/tool/truncate"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { Shell } from "@/shell/shell"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

const max = process.env.KILO_COMMAND_TIMEOUT_MAX_MS
const msg = process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE
const encoder = new TextEncoder()
const it = testEffect(Layer.empty)
const shell = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
    RuntimeFlags.defaultLayer,
  ),
)

function handle(input: {
  exit?: ChildProcessSpawner.ChildProcessHandle["exitCode"]
  stdout?: ChildProcessSpawner.ChildProcessHandle["stdout"]
  stderr?: ChildProcessSpawner.ChildProcessHandle["stderr"]
  kill?: ChildProcessSpawner.ChildProcessHandle["kill"]
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: input.exit ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: input.kill ?? (() => Effect.void),
    stdin: Sink.drain,
    stdout: input.stdout ?? Stream.empty,
    stderr: input.stderr ?? Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  })
}

afterEach(() => {
  if (max === undefined) delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS
  else process.env.KILO_COMMAND_TIMEOUT_MAX_MS = max
  if (msg === undefined) delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE
  else process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = msg
})

describe("CommandTimeout", () => {
  // Pure policy coverage: no process or timer waits.
  test("resolves hosted timeout policy", () => {
    for (const value of [undefined, "0", "-1", "abc"]) {
      if (value === undefined) delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS
      else process.env.KILO_COMMAND_TIMEOUT_MAX_MS = value
      expect(CommandTimeout.env()).toBeUndefined()
    }

    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "250"
    process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = " You're running in a sandbox. "

    expect(CommandTimeout.clamp(500)).toEqual({ timeout: 250, capped: true })
    expect(CommandTimeout.clamp(250)).toEqual({ timeout: 250, capped: true })
    expect(CommandTimeout.clamp(200)).toEqual({ timeout: 200, capped: false })
    expect(CommandTimeout.duration(250)).toBe(250)
    expect(CommandTimeout.duration(200)).toBe(300)
    expect(CommandTimeout.env()).toEqual({ timeout: 250, capped: true })
    expect(CommandTimeout.note({ timeout: 250, capped: true }, "shell command terminated")).toBe(
      "shell command terminated after exceeding environment timeout 250 ms. You're running in a sandbox.",
    )
  })

  // TestClock advances instantly; this does not wait 25 ms in real time.
  it.effect("caps output draining at the exact environment deadline", () =>
    Effect.gen(function* () {
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "25"
      const state = { killed: false }
      const child = handle({
        exit: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        kill: () =>
          Effect.sync(() => {
            state.killed = true
          }),
      })
      const fiber = yield* CommandTimeout.drain(child, Effect.never, "shell command terminated").pipe(
        Effect.forkChild,
      )
      yield* Effect.yieldNow

      yield* TestClock.adjust("24 millis")
      expect(state.killed).toBe(false)
      yield* TestClock.adjust("1 millis")
      expect(state.killed).toBe(true)
      expect(yield* Fiber.join(fiber)).toBe(
        "shell command terminated after exceeding environment timeout 25 ms.",
      )
    }),
  )

  // A fake spawner and Deferred prove concurrency without launching processes.
  it.effect("captures command substitutions concurrently without stderr", () =>
    Effect.gen(function* () {
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "500"
      const gate = yield* Deferred.make<void>()
      const state = { started: 0 }
      const spawner = ChildProcessSpawner.make(() =>
        Effect.sync(() => {
          state.started++
          const text = state.started === 1 ? "first" : "second"
          const wait = Stream.fromEffect(Deferred.await(gate))
          return handle({
            exit: Deferred.await(gate).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
            stdout: wait.pipe(Stream.flatMap(() => Stream.make(encoder.encode(text)))),
            stderr: Stream.make(encoder.encode("warning")),
          })
        }),
      )
      const fiber = yield* CommandTimeout.texts(["one", "two"], "sh").pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.forkChild,
      )
      yield* Effect.yieldNow

      expect(state.started).toBe(2)
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(fiber)).toEqual(["first", "second"])
    }),
  )
})

// This is the only real process and wall-clock timeout in this suite.
shell.instance(
  "caps shell tool timeouts with hosted guidance",
  () =>
    Effect.gen(function* () {
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "500"
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = "You're running in a sandbox."
      const name = Shell.name(Shell.acceptable())
      const exe = JSON.stringify(process.execPath)
      const script = "process.stdout.write(String.fromCharCode(115,116,97,114,116,101,100));setTimeout(()=>{},30000)"
      const command = name === "powershell" || name === "pwsh" ? `& ${exe} -e '${script}'` : `${exe} -e '${script}'`
      const info = yield* ShellTool
      const tool = yield* info.init()
      const result = yield* tool.execute(
        { command, description: "Hosted timeout" },
        {
          sessionID: SessionID.make("ses_test"),
          messageID: MessageID.make("msg_test"),
          callID: "",
          agent: "code",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("started")
      expect(result.output).toContain("environment timeout 500 ms")
      expect(result.output).toContain("You're running in a sandbox.")
      expect(result.output).not.toContain("retry with a larger timeout")
    }),
  15_000,
)
