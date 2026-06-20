import open from "open"
import { cmd } from "@/cli/cmd/cmd"
import { explicitNetworkOptions, withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { serverUrls } from "@/kilocode/cli/server-urls"
import { AppRuntime } from "@/effect/app-runtime"
import { Daemon } from "@/kilocode/daemon/daemon"
import { warnPort } from "@/kilocode/cli/port-warning"
import { hasDisplay } from "@/kilocode/cli/cmd/tui/util/display"

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

export const KiloConsoleCommand = cmd({
  command: "console",
  describe: "open the local Kilo Console",
  builder: (yargs) => withNetworkOptions(yargs),
  handler: async (args) => {
    const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
    warnPort(opts.port)
    const daemon = await Daemon.ensure(opts, explicitNetworkOptions())
    if (daemon.restarted) console.warn("Restarted the Kilo daemon to apply the requested network options")
    const state = daemon.result.state
    if (!state) throw new Error("Kilo daemon did not provide connection state")

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
  },
})
