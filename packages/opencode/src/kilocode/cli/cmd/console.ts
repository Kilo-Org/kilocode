import open from "open"
import type { Argv } from "yargs"
import { cmd } from "@/cli/cmd/cmd"
import { explicitNetworkOptions, withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { serverUrls } from "@/kilocode/cli/server-urls"
import { AppRuntime } from "@/effect/app-runtime"
import { Daemon } from "@/kilocode/daemon/daemon"
import { warnPort } from "@/kilocode/cli/port-warning"
import { hasDisplay } from "@/kilocode/cli/cmd/tui/util/display"
import { StopCommand } from "@/kilocode/cli/cmd/daemon"

function browserUrl(state: Daemon.State) {
  const url = new URL("/console", state.url)
  url.username = state.username
  url.password = state.password
  return url.toString()
}

async function launch(url: string) {
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

// kilocode_change start - default to foreground so Ctrl+C stops the daemon (#11466)
const OpenCommand = cmd({
  command: "$0",
  describe: "open the local Kilo Console",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("background", {
        alias: "b",
        describe: "open browser and exit immediately without keeping the daemon attached",
        type: "boolean",
      })
      .option("foreground", {
        alias: "f",
        describe: "deprecated: console now runs in the foreground by default",
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    const run = async (signal?: AbortSignal) => {
      const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
      warnPort(opts.port)
      const daemon = await Daemon.ensure(opts, explicitNetworkOptions())
      const state = daemon.result.state
      if (!state) throw new Error("Kilo daemon did not provide connection state")
      if (signal?.aborted) return state
      if (daemon.restarted) console.warn("Restarted the Kilo daemon to apply the requested network options")

      const urls = state.urls ?? serverUrls(state.hostname, state.port)
      const consoleLocal = `${urls.local}/console`
      const consoleNetwork = urls.network ? `${urls.network}/console` : undefined

      if (hasDisplay()) {
        await launch(browserUrl(state)).catch((err) => {
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
    // Default to foreground so the process stays attached and Ctrl+C stops the daemon.
    // Use --background to restore the old detach-and-exit behavior.
    if (args.background) {
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
// kilocode_change end

export const KiloConsoleCommand = cmd({
  command: "console",
  describe: "open or stop the local Kilo Console",
  builder: (yargs: Argv) => yargs.command(OpenCommand).command(StopCommand).demandCommand(),
  handler: async () => {},
})
