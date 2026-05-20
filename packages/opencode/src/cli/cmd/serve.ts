import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceRuntime } from "../../project/instance-runtime" // kilocode_change
import * as Log from "@opencode-ai/core/util/log" // kilocode_change

const log = Log.create({ service: "serve" }) // kilocode_change

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

    // kilocode_change start
    const abort = new AbortController()
    const shutdown = async (reason: string) => {
      if (abort.signal.aborted) return
      log.info("shutting down", { reason })
      try {
        await InstanceRuntime.disposeAllInstances()
        await server.stop(true)
      } finally {
        abort.abort()
      }
    }
    const onSignal = (reason: string) => shutdown(reason).catch((err) => {
      log.error("signal shutdown failed", { err })
      process.exit(1)
    })
    process.on("SIGTERM", () => onSignal("sigterm"))
    process.on("SIGINT", () => onSignal("sigint"))
    process.on("SIGHUP", () => onSignal("sighup"))

    // Orphan detection: exit if parent dies without sending a signal
    const parentPid = process.ppid
    const orphanWatch = setInterval(() => {
      if (abort.signal.aborted) return
      const orphaned = (() => {
        if (process.ppid !== parentPid) return true
        if (parentPid === 1) return false
        try {
          process.kill(parentPid, 0)
          return false
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code !== "ESRCH") {
            log.debug("parent liveness check failed", { parentPid, code, error: err })
            return false
          }
          log.debug("detected dead parent", { parentPid, error: err })
          return true
        }
      })()
      if (!orphaned) return
      shutdown("parent-exit").catch((err) => {
        log.error("orphan shutdown failed", { err })
      })
    }, 1000)
    orphanWatch.unref()
    // kilocode_change end

    yield* Effect.promise(() => new Promise<void>((resolve) => abort.signal.addEventListener("abort", resolve)))
  }),
})
