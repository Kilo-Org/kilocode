import { expect, test } from "bun:test"
import { Effect, Scheduler } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"

test.each(["stdout", "stderr"] as const)(
  "captures fast-exiting %s across scheduler yields during spawn",
  async (stream) => {
    // Let the child exit while the spawning fiber yields, before its caller starts consuming stdout.
    const scheduler = new Scheduler.MixedScheduler("async", (run) => {
      const timer = setTimeout(run, 30)
      return () => clearTimeout(timer)
    })
    const output = await Effect.runPromise(
      Effect.scoped(
        ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(ChildProcess.make(process.execPath, ["-e", `process.${stream}.write("ok")`]), {
            includeStderr: stream === "stderr",
          }),
        ),
      ).pipe(
        Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
        Effect.provideService(Scheduler.MaxOpsBeforeYield, 5),
      ),
      { scheduler },
    )
    expect(output).toBe("ok")
  },
  30_000,
)
