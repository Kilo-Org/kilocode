import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { KiloSessionResume } from "./resume"
import { KiloRetentionScheduler } from "./scheduler"

export namespace KiloRetentionWorker {
  // The TUI parent calls this after resume protection and RPC readiness. A
  // cloud import passes its new session so the imported history is fresh.
  export async function start(input: { session: string } | undefined) {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        if (input) yield* KiloSessionResume.resolve(input)
        yield* KiloRetentionScheduler.Service.use((s) => s.start())
      }),
    )
  }

  export async function stop() {
    await AppRuntime.runPromise(KiloRetentionScheduler.Service.use((s) => s.stop()))
  }
}
