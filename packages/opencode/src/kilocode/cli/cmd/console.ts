import type { Argv } from "yargs"
import type { Daemon } from "@/kilocode/daemon/daemon"
import { cmd } from "@/cli/cmd/cmd"
import { explicitNetworkOptions, withNetworkOptions } from "@/cli/network"
import { serverUrls } from "@/kilocode/cli/server-urls"
import { hasDisplay } from "@/kilocode/cli/cmd/tui/util/display"
import { StopCommand } from "@/kilocode/cli/cmd/daemon"

// Keep the top-level import graph light: this module is registered eagerly at CLI
// startup, so implementation dependencies are imported inside handlers (same
// deferral pattern as upstream opencode#30453).
function withCredentials(base: string, state: Daemon.State) {
  const url = new URL("/console", base)
  url.username = state.username
  url.password = state.password
  return url.toString()
}

async function launch(url: string) {
  const { default: open } = await import("open")
  const child = await open(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 500)
    child.once("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once("exit", (code) => {
      if (code === null || code === 0) {
        clearTimeout(timer)
        resolve()
        return
      }
      clearTimeout(timer)
      reject(new Error(`Browser open failed with exit code ${code}`))
    })
  })
}

const OpenCommand = cmd({
  command: "$0",
  describe: "open the local Kilo Console (deprecated)",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("foreground", {
      alias: "f",
      describe: "keep the command active until interrupted",
      type: "boolean",
    }),
  handler: async (args) => {
    console.warn("Kilo Console is deprecated and will be removed in a future release.")
    const { Daemon } = await import("@/kilocode/daemon/daemon")
    const { warnedNetworkOptions } = await import("@/kilocode/cli/port-warning")
    const run = async (signal?: AbortSignal) => {
      const opts = await warnedNetworkOptions(args)
      const daemon = await Daemon.ensure(opts, explicitNetworkOptions())
      const state = daemon.result.state
      if (!state) throw new Error("Kilo daemon did not provide connection state")
      if (signal?.aborted) return state
      if (daemon.restarted) console.warn("Restarted the Kilo daemon to apply the requested network options")

      const urls = state.urls ?? serverUrls(state.hostname, state.port)
      const consoleLocal = withCredentials(urls.local, state)
      const consoleNetwork = urls.network ? withCredentials(urls.network, state) : undefined

      if (hasDisplay()) {
        await launch(consoleLocal).catch((err) => {
          console.warn(`Could not open browser automatically: ${err instanceof Error ? err.message : String(err)}`)
        })
      } else {
        console.warn("No display detected; open the Kilo Console URL manually")
      }
      console.log("Kilo Console:")
      console.log(`  Local:   ${consoleLocal}`)
      if (consoleNetwork) console.log(`  Network: ${consoleNetwork}`)
      return state
    }
    if (!args.foreground) {
      await run()
      return
    }
    await Daemon.foreground(async (signal) => {
      const state = await run(signal)
      if (!signal.aborted) console.log("Press Ctrl+C to stop the Kilo daemon.")
      return state
    })
  },
})

export const KiloConsoleCommand = cmd({
  command: "console",
  describe: "open or stop the local Kilo Console (deprecated)",
  builder: (yargs: Argv) => yargs.command(OpenCommand).command(StopCommand).demandCommand(),
  handler: async () => {},
})
