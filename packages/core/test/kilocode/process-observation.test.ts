import { expect } from "bun:test"
import { Effect, Exit, Deferred } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { ExecutionObservation } from "@kilocode/sandbox"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"

const fx = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

fx.effect(
  "native spawn reports exit 7 independently of policy",
  Effect.gen(function* () {
    const events: string[] = []
    const done = yield* Deferred.make<void>()
    const observer: ExecutionObservation = {
      call: "call",
      verify() {
        events.push("verified")
      },
      emit(kind, detail) {
        events.push(kind)
        if (kind === "execution_finished") {
          expect(detail.exit_code).toBe(7)
          Deferred.doneUnsafe(done, Exit.void)
        }
      },
    }
    yield* Effect.gen(function* () {
      const handle = yield* ChildProcess.make(process.execPath, ["-e", "process.exit(7)"])
      expect(yield* handle.exitCode).toBe(ExitCode(7))
      yield* Deferred.await(done)
    }).pipe(Effect.provideService(ExecutionObservation, observer))
    expect(events).toEqual(["verified", "execution_started", "execution_finished"])
  }),
)

fx.effect(
  "failed final verification and failed spawn never report execution",
  Effect.gen(function* () {
    for (const reject of [true, false]) {
      const events: string[] = []
      const result = yield* Effect.exit(
        ChildProcess.make("/autoguard-nonexistent-command").pipe(
          Effect.provideService(ExecutionObservation, {
            call: "call",
            verify() {
              if (reject) throw new Error("changed_target")
            },
            emit(kind) {
              events.push(kind)
            },
          }),
        ),
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect(events).toEqual([])
    }
  }),
)
