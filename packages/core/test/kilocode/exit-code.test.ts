import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { settle } from "@opencode-ai/core/kilocode/exit-code"
import { testEffect } from "../lib/effect"

const fx = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

const code = (exit: readonly [number | null, NodeJS.Signals | null]) => Effect.runPromise(settle(exit))

describe("exit-code settle", () => {
  test("maps exit results to numeric codes", async () => {
    expect(await code([0, null])).toBe(ChildProcessSpawner.ExitCode(0))
    expect(await code([42, null])).toBe(ChildProcessSpawner.ExitCode(42))
    expect(await code([null, "SIGSEGV"])).toBe(ChildProcessSpawner.ExitCode(128 + 11))
    expect(await code([null, "SIGTERM"])).toBe(ChildProcessSpawner.ExitCode(128 + 15))
    expect(await code([null, null])).toBe(ChildProcessSpawner.ExitCode(1))
    expect(await code([null, "SIGWHAT" as NodeJS.Signals])).toBe(ChildProcessSpawner.ExitCode(1))
  })

  fx.effect(
    "reports signal termination as 128 + signum",
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const handle = yield* ChildProcess.make(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"])
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(128 + 9))
    }),
  )
})
