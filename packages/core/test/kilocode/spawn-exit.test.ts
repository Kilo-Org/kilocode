import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as SpawnExit from "@opencode-ai/core/kilocode/spawn-exit"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

function signal(pid: number, sig: 0 | "SIGKILL") {
  try {
    process.kill(pid, sig)
    return true
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ESRCH")) throw err
    return false
  }
}

describe("spawner foreground exit", () => {
  if (process.platform === "win32") return

  for (const direct of [false, true]) {
    it.live(
      `kill succeeds after foreground exit even when a detached child holds stdio (${direct ? "exit" : "close"} mode)`,
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const file = Bun.file(`${tmp.path}/child`)
        const clean = Effect.promise(async () => {
          const pid = Number(await file.text().catch(() => ""))
          if (pid > 0) signal(pid, "SIGKILL")
        })
        const cmd = ChildProcess.make(
          process.execPath,
          [
            "-e",
            `const child = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
              detached: true, stdio: ["ignore", "inherit", "inherit"]
            });
            child.unref();
            require("node:fs").writeFileSync("child", String(child.pid));`,
          ],
          { cwd: tmp.path, forceKillAfter: "500 millis" },
        )
        const fiber = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* direct ? SpawnExit.attach(cmd) : cmd
            while (signal(handle.pid, 0)) yield* Effect.sleep("20 millis")
            const pid = Number(yield* Effect.promise(() => file.text()))
            expect(pid).toBeGreaterThan(0)
            expect(signal(pid, 0)).toBe(true)
            yield* handle.kill({ forceKillAfter: "500 millis" })
            expect(yield* handle.isRunning).toBe(!direct)
            if (direct) expect(Number(yield* handle.exitCode)).toBe(0)
            return pid
          }),
        ).pipe(Effect.forkScoped)
        yield* Effect.gen(function* () {
          const pid = yield* Fiber.join(fiber).pipe(Effect.timeout("3 seconds"))
          expect(signal(pid, 0)).toBe(true)
        }).pipe(Effect.ensuring(clean))
      }),
      10_000,
    )
  }
})
