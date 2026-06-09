import os from "os"
import open from "open"
import { cmd } from "@/cli/cmd/cmd"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { AppRuntime } from "@/effect/app-runtime"
import { Daemon } from "@/kilocode/daemon/daemon"

function publicUrl(state: Daemon.State) {
  return new URL("/console", state.url).toString()
}

export function wildcard(hostname: string) {
  return hostname === "0.0.0.0" || hostname === "::"
}

export function covers(state: { hostname: string; port: number }, opts: { hostname: string; port: number }) {
  if (opts.port !== 0 && opts.port !== state.port) return false
  if (wildcard(state.hostname)) return true
  return state.hostname === opts.hostname
}

export function addresses(
  interfaces: Record<
    string,
    { address: string; family: string; internal: boolean }[] | undefined
  > = os.networkInterfaces(),
) {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address)
}

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
    const result = await Daemon.start(opts)
    const state = result.state
    if (!state) throw new Error("Kilo daemon did not provide connection state")

    if (result.reused && !covers(state, opts)) {
      const requested = `${opts.hostname}${opts.port ? `:${opts.port}` : ""}`
      console.warn(
        `Kilo daemon is already running on ${state.hostname}:${state.port}; requested ${requested} was not applied.`,
      )
      console.warn(
        `Run \`kilo daemon restart --hostname ${opts.hostname}${opts.port ? ` --port ${opts.port}` : ""}\` to rebind.`,
      )
    }

    const url = publicUrl(state)
    await launch(browserUrl(state)).catch((err) => {
      console.warn(`Could not open browser automatically: ${err instanceof Error ? err.message : String(err)}`)
    })
    console.log(`Kilo Console: ${url}`)
    if (wildcard(state.hostname)) {
      console.log(`Bound to all interfaces (${state.hostname})`)
      for (const item of addresses()) console.log(`  http://${item}:${state.port}/console`)
    }
  },
})
