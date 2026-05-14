import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceStore } from "../../project/instance-store" // kilocode_change

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server",
  // Server loads instances per-request via x-kilo-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false, // kilocode_change
  handler: Effect.fn("Cli.serve")(function* (args) {
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`kilo server listening on http://${server.hostname}:${server.port}`) // kilocode_change

    // kilocode_change start - graceful signal shutdown (replaces upstream `yield* Effect.never`)
    const abort = new AbortController()
    const shutdown = () => {
      void (async () => {
        try {
          await InstanceStore.disposeAllInstances()
          await server.stop(true)
        } finally {
          abort.abort()
        }
      })()
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)
    yield* Effect.promise(
      () => new Promise<void>((resolve) => abort.signal.addEventListener("abort", () => resolve())),
    )
    // kilocode_change end
  }),
})
