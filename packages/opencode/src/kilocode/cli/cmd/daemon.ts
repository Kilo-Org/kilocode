import type { Argv } from "yargs"
import { cmd } from "@/cli/cmd/cmd"
import { explicitNetworkOptions, withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { AppRuntime } from "@/effect/app-runtime"
import { Daemon } from "@/kilocode/daemon/daemon"
import { warnPort } from "@/kilocode/cli/port-warning"

function withJson<T>(yargs: Argv<T>) {
  return yargs.option("json", {
    describe: "print daemon details as JSON",
    type: "boolean",
  })
}

function withForeground<T>(yargs: Argv<T>) {
  return yargs.option("foreground", {
    alias: "f",
    describe: "keep the command active until interrupted",
    type: "boolean",
  })
}

function safe(input: Daemon.State | undefined) {
  if (!input) return undefined
  return {
    pid: input.pid,
    hostname: input.hostname,
    port: input.port,
    url: input.url,
    urls: input.urls,
    username: input.username,
    version: input.version,
    startedAt: input.startedAt,
    log: input.log,
  }
}

function print(input: Daemon.Status, json?: boolean) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ...input,
          state: safe(input.state),
        },
        null,
        2,
      ),
    )
    return
  }
  if (!input.running) {
    console.log(input.stale ? `kilo daemon stale: ${input.reason}` : `kilo daemon not running`)
    console.log(`state: ${input.file}`)
    if (input.state?.log) console.log(`log: ${input.state.log}`)
    return
  }
  console.log(`kilo daemon running`)
  if (input.state?.urls) {
    const urls = input.state.urls
    console.log(`local:   ${urls.local}`)
    if (urls.network) console.log(`network: ${urls.network}`)
  } else {
    console.log(`url: ${input.state?.url}`)
  }
  console.log(`pid: ${input.state?.pid}`)
  console.log(`version: ${input.health?.version ?? input.state?.version}`)
  console.log(`auth: enabled`)
  console.log(`state: ${input.file}`)
  console.log(`log: ${input.state?.log}`)
}

async function hold(enabled: boolean, json: boolean, run: (signal?: AbortSignal) => Promise<Daemon.State>) {
  if (!enabled) {
    await run()
    return
  }
  await Daemon.foreground(async (signal) => {
    const state = await run(signal)
    if (!signal.aborted && !json) console.log("Press Ctrl+C to stop the Kilo daemon.")
    return state
  })
}

function start(command: string) {
  return cmd({
    command,
    describe: "start the local kilo daemon",
    builder: (yargs) => withForeground(withJson(withNetworkOptions(yargs))),
    handler: async (args) => {
      await hold(Boolean(args.foreground), Boolean(args.json), async (signal) => {
        const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
        warnPort(opts.port)
        const daemon = await Daemon.ensure(opts, explicitNetworkOptions())
        const result = daemon.result
        const state = result.state
        if (!state) throw new Error("Kilo daemon did not provide process state")
        if (signal?.aborted) return state
        if (args.json) print(result, true)
        if (!args.json) {
          console.log(
            result.reused
              ? "kilo daemon already running"
              : daemon.restarted
                ? "kilo daemon restarted"
                : "kilo daemon started",
          )
          print(result)
        }
        return state
      })
    },
  })
}

const DefaultCommand = start("$0")
const StartCommand = start("start")

const StatusCommand = cmd({
  command: "status",
  describe: "show local kilo daemon status",
  builder: (yargs) => withJson(yargs),
  handler: async (args) => {
    print(await Daemon.status(), Boolean(args.json))
  },
})

export const StopCommand = cmd({
  command: "stop",
  describe: "stop the local kilo daemon",
  builder: (yargs) => withJson(yargs),
  handler: async (args) => {
    const result = await Daemon.stop()
    if (args.json) {
      print(result, true)
      return
    }
    console.log(result.stopped ? "kilo daemon stopped" : "kilo daemon not running")
  },
})

const RestartCommand = cmd({
  command: "restart",
  describe: "restart the local kilo daemon",
  builder: (yargs) => withForeground(withJson(withNetworkOptions(yargs))),
  handler: async (args) => {
    await hold(Boolean(args.foreground), Boolean(args.json), async (signal) => {
      const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
      warnPort(opts.port)
      const result = await Daemon.restart(opts)
      const state = result.state
      if (!state) throw new Error("Kilo daemon did not provide process state")
      if (signal?.aborted) return state
      if (args.json) print(result, true)
      if (!args.json) {
        console.log("kilo daemon restarted")
        print(result)
      }
      return state
    })
  },
})

export const DaemonCommand = cmd({
  command: "daemon",
  describe: "manage the local kilo daemon",
  builder: (yargs: Argv) =>
    yargs
      .command(DefaultCommand)
      .command(StartCommand)
      .command(StatusCommand)
      .command(StopCommand)
      .command(RestartCommand)
      .demandCommand(),
  handler: async () => {},
})
