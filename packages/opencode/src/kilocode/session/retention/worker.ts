import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { KiloSessionResume } from "./resume"
import { KiloRetentionScheduler } from "./scheduler"
import { KiloRetentionTui } from "./tui"

export namespace KiloRetentionWorker {
  // Set by the TUI parent for --cloud-fork. Cleanup then waits until the parent
  // has imported and protected the session, so the first pass and its VACUUM
  // do not run concurrently with the import's writes.
  export const defer = KiloRetentionTui.defer

  // The parent RPC also calls this. A cloud import passes its new session so
  // the imported history is fresh before cleanup starts.
  export async function start(input: { session: string } | undefined) {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        if (input) yield* KiloSessionResume.resolve(input)
        yield* KiloRetentionScheduler.Service.use((s) => s.start())
      }),
    )
  }

  // Runs when the worker starts listening. The parent protects a resumed
  // session before it spawns the worker. A request that the parent sends
  // before the worker is listening can be dropped, so the worker starts
  // cleanup itself.
  export function boot() {
    if (process.env[defer] === "1") return
    void KiloRetentionWorker.start(undefined).catch((err) => console.error("TUI worker retention start failed", err))
  }

  export async function stop() {
    await AppRuntime.runPromise(KiloRetentionScheduler.Service.use((s) => s.stop()))
  }
}
