// Regression tests for Kilo-Org/kilocode#12677.
//
// A shell terminated by a signal (for example `bash -c` exec'ing a binary that
// then segfaults) produces no numeric exit code. The spawner used to fail the
// exit-code effect in that case, so the bash tool's race kept waiting for the
// abort or timeout branches and the call appeared to hang. The spawner now
// settles signal termination as the conventional 128 + signum code.

import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Plugin } from "../../../src/plugin"
import { SessionID, MessageID } from "../../../src/session/schema"
import { ShellTool } from "../../../src/tool/shell"
import { Truncate } from "../../../src/tool/truncate"
import { provideInstance, TestInstance, testInstanceStoreLayer } from "../../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  AppNodeBuilder.build(FSUtil.node),
  AppNodeBuilder.build(Plugin.node),
  AppNodeBuilder.build(Truncate.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(Agent.node),
  AppNodeBuilder.build(RuntimeFlags.node),
  testInstanceStoreLayer,
)
const it = testEffect(layer)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../../..")

const pid = (dir: string, name: string) =>
  Effect.promise(
    async () =>
      Number(
        await Bun.file(path.join(dir, name))
          .text()
          .catch(() => ""),
      ) || undefined,
  )

const stopped = (pid: number) =>
  Effect.sync(() => {
    // An orphan can remain a zombie on CI hosts that don't promptly reap it.
    const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
      .stdout.toString()
      .trim()
    return !stat || stat.startsWith("Z") ? true : undefined
  })

const cleanup = (dir: string) =>
  Effect.gen(function* () {
    const leader = yield* pid(dir, "foreground")
    if (!leader) return
    try {
      process.kill(-leader, "SIGKILL")
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "ESRCH")) throw err
    }
  })

describe("shell tool process completion", () => {
  if (process.platform === "win32") return

  for (const code of [0, 17]) {
    it.instance(
      `retains all trailing stdout and stderr with exit code ${code}`,
      Effect.gen(function* () {
        const tool = yield* ShellTool
        const bash = yield* tool.init()
        const result = yield* bash
          .execute(
            {
              command: `printf 'stdout before\nstdout last\n'; printf 'stderr before\nstderr last\n' >&2; exit ${code}`,
              description: "Write to both streams and exit",
            },
            ctx,
          )
          .pipe(Effect.timeout("5 seconds"))
        expect(result.metadata.exit).toBe(code)
        expect(result.output.trim().split("\n").sort()).toEqual([
          "stderr before",
          "stderr last",
          "stdout before",
          "stdout last",
        ])
      }),
      { config: { shell: "bash" } },
      10_000,
    )
  }

  for (const mode of ["exit", "abort", "timeout", "interrupt"] as const) {
    it.instance(
      `completes on ${mode} and cleans up a SIGTERM-resistant child holding both pipes open`,
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const tool = yield* ShellTool
        const bash = yield* tool.init()
        const abort = new AbortController()
        const command = [
          `printf '%s\n' "$$" > foreground`,
          `sh -c 'trap "" TERM; printf "%s\n" "$$" > worker; exec sleep 30' &`,
          `while [ ! -s worker ]; do sleep 0.02; done`,
          `printf 'last stdout\n'; printf 'last stderr\n' >&2`,
          mode === "exit" ? "" : `trap "" TERM`,
          `printf '%s\n' "$$" > ready`,
          mode === "exit" ? "exit 0" : "wait",
        ].join("\n")
        const fiber = yield* bash
          .execute(
            {
              command,
              description: "Run with an inherited stdio holder",
              timeout: mode === "timeout" ? 1_500 : 60_000,
            },
            { ...ctx, abort: abort.signal },
          )
          .pipe(Effect.forkScoped)

        // Kill the fixture's group before the outer scope joins its execution fiber, even if the
        // tool's finalizer itself gets stuck waiting for those pipes.
        yield* Effect.gen(function* () {
          const child = yield* pollWithTimeout(pid(dir, "worker"), "worker did not start")
          const leader = yield* pollWithTimeout(pid(dir, "ready"), "foreground did not report readiness")
          if (mode === "exit") yield* pollWithTimeout(stopped(leader), "foreground did not exit")
          if (mode === "abort") abort.abort()

          if (mode === "interrupt") {
            // Interrupt asynchronously so the test deadline does not join a stalled finalizer.
            yield* Fiber.interrupt(fiber).pipe(Effect.forkScoped)
            const exit = yield* awaitWithTimeout(Fiber.await(fiber), "shell tool scope did not finalize", "6 seconds")
            expect(Exit.isFailure(exit)).toBe(true)
          } else {
            const result = yield* awaitWithTimeout(Fiber.join(fiber), `shell tool hung after ${mode}`, "6 seconds")
            expect(result.metadata.exit).toBe(mode === "exit" ? 0 : null)
            expect(result.output).toContain("last stdout\n")
            expect(result.output).toContain("last stderr\n")
            if (mode === "timeout") expect(result.output).toContain("exceeding timeout")
            if (mode === "abort") expect(result.output).toContain("User aborted the command")
          }
          yield* pollWithTimeout(stopped(child), "shell descendant was left running", "1 second")
          yield* pollWithTimeout(stopped(leader), "foreground shell was left running", "1 second")
        }).pipe(Effect.ensuring(cleanup(dir)))
      }),
      { config: { shell: "bash" } },
      15_000,
    )
  }
})

describe("shell tool signal termination", () => {
  if (process.platform !== "win32") {
    it.live("settles with 128 + signum when the shell dies from a signal", () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const tool = yield* ShellTool
          const bash = yield* tool.init()
          const result = yield* bash
            .execute(
              {
                command: "kill -SEGV $$",
                description: "Terminate the shell with SIGSEGV",
                timeout: 60_000,
              },
              ctx,
            )
            .pipe(Effect.timeout("5 seconds"))
          expect(result.metadata.exit).toBe(128 + 11)
          expect(result.output).not.toContain("exceeding timeout")
        }),
      ),
    )
  }
})
