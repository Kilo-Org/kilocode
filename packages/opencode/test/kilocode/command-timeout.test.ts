import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber, Stream } from "effect"
import * as Sink from "effect/Sink"
import * as TestClock from "effect/testing/TestClock"
import { ChildProcessSpawner } from "effect/unstable/process"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { CommandTimeout } from "@/kilocode/command-timeout"
import { testEffect } from "../lib/effect"

const max = process.env.KILO_COMMAND_TIMEOUT_MAX_MS
const msg = process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE
const it = testEffect(CrossSpawnSpawner.defaultLayer)
const encoder = new TextEncoder()

afterEach(() => {
  if (max === undefined) delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS
  else process.env.KILO_COMMAND_TIMEOUT_MAX_MS = max
  if (msg === undefined) delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE
  else process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = msg
})

describe("CommandTimeout", () => {
  test("reads positive command caps dynamically", () => {
    delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS
    expect(Flag.KILO_COMMAND_TIMEOUT_MAX_MS).toBeUndefined()

    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "0"
    expect(Flag.KILO_COMMAND_TIMEOUT_MAX_MS).toBeUndefined()

    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "-1"
    expect(Flag.KILO_COMMAND_TIMEOUT_MAX_MS).toBeUndefined()

    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "abc"
    expect(Flag.KILO_COMMAND_TIMEOUT_MAX_MS).toBeUndefined()

    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "250"
    expect(Flag.KILO_COMMAND_TIMEOUT_MAX_MS).toBe(250)
  })

  test("clamps deadlines and formats environment timeout notes", () => {
    process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "250"
    process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = "You're running in a sandbox with a fixed timeout."

    expect(CommandTimeout.clamp(500)).toEqual({ timeout: 250, capped: true })
    expect(CommandTimeout.clamp(250)).toEqual({ timeout: 250, capped: true })
    expect(CommandTimeout.clamp(200)).toEqual({ timeout: 200, capped: false })

    const limit = CommandTimeout.env()
    expect(limit).toEqual({ timeout: 250, capped: true })
    if (!limit) throw new Error("missing timeout cap")
    expect(CommandTimeout.note(limit, "shell tool terminated command")).toBe(
      "shell tool terminated command after exceeding environment timeout 250 ms. You're running in a sandbox with a fixed timeout.",
    )
  })

  it.effect("enforces the environment deadline without grace", () =>
    Effect.gen(function* () {
      const state = { killed: false }
      const handle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () =>
          Effect.sync(() => {
            state.killed = true
          }),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
      const fiber = yield* CommandTimeout.wait(handle, Effect.never, { timeout: 25, capped: true }).pipe(
        Effect.forkChild,
      )
      yield* Effect.yieldNow

      yield* TestClock.adjust("24 millis")
      expect(state.killed).toBe(false)
      yield* TestClock.adjust("1 millis")
      expect(state.killed).toBe(true)
      expect(yield* Fiber.join(fiber)).toBe(true)
    }),
  )

  it.live("preserves uncapped shell expansion output", () =>
    Effect.gen(function* () {
      const shell = Bun.which("bash")
      if (!shell) return
      delete process.env.KILO_COMMAND_TIMEOUT_MAX_MS

      const text = yield* CommandTimeout.text("[[ 1 -eq 1 ]] && printf configured", shell)
      expect(text).toBe("configured")
    }),
  )

  it.live("keeps capped shell expansion stderr out of text", () =>
    Effect.gen(function* () {
      const shell = Bun.which("sh")
      if (!shell) return
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "500"

      const text = yield* CommandTimeout.text("printf configured; printf warning >&2", shell)
      expect(text).toBe("configured")
    }),
  )

  it.live("caps shell expansion output draining after process exit", () =>
    Effect.gen(function* () {
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "25"
      const state = { killed: false }
      const wait = Stream.fromEffect(Effect.sleep("250 millis")).pipe(Stream.flatMap(() => Stream.empty))
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(0),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () =>
              Effect.sync(() => {
                state.killed = true
              }),
            stdin: Sink.drain,
            stdout: Stream.concat(Stream.make(encoder.encode("configured")), wait),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      )

      const text = yield* CommandTimeout.text("ignored", "sh").pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      )
      expect(text).toContain("configured")
      expect(text).toContain("shell command terminated after exceeding environment timeout 25 ms.")
      expect(state.killed).toBe(true)
    }),
  )

  it.live("propagates output drain failures before the deadline", () =>
    Effect.gen(function* () {
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "25"
      const state = { killed: false }
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(0),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () =>
              Effect.sync(() => {
                state.killed = true
              }),
            stdin: Sink.drain,
            stdout: Stream.die(new Error("drain failed")),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      )

      const exit = yield* CommandTimeout.text("ignored", "sh").pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.exit,
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(state.killed).toBe(false)
    }),
  )

  it.live("terminates capped shell expansion output", () =>
    Effect.gen(function* () {
      const shell = Bun.which("sh")
      if (!shell) return
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS = "500"
      process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE = "You're running in a sandbox with a fixed timeout."

      const text = yield* CommandTimeout.text("printf before; sleep 30", shell)
      expect(text).toContain("before")
      expect(text).toContain("shell command terminated after exceeding environment timeout 500 ms.")
      expect(text).toContain("You're running in a sandbox with a fixed timeout.")
    }),
  )
})
