import { Effect } from "effect"
import { KiloSessionResume } from "./resume"
import { KiloRetentionScheduler } from "./scheduler"

export namespace KiloRetentionRun {
  type Args = { attach?: string; session?: string; continue?: boolean; "cloud-fork"?: boolean }

  // A local `kilo run` protects the resumed session, then starts cleanup.
  // Space reclamation waits until foreground work finishes.
  export const start = Effect.fn("KiloRetentionRun.start")(function* (args: Args) {
    if (args.attach) return
    const id = yield* KiloSessionResume.run({ ...args, cloudFork: args["cloud-fork"] })
    if (id) args.session = id
    yield* KiloRetentionScheduler.Service.use((s) => s.start({ defer: true }))
  })
}
