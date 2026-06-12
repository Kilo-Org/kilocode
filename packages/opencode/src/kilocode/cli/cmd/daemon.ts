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

function safe(input: Daemon.State | undefined) {
  if (!input) return undefined
  return {
    pid: input.pid,
    hostname: input.hostname,
    port: input.port,
    url: input.url,
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
  console.log(`url: ${input.state?.url}`)
  console.log(`pid: ${input.state?.pid}`)
  console.log(`version: ${input.health?.version ?? input.state?.version}`)
  console.log(`auth: enabled`)
  console.log(`state: ${input.file}`)
  console.log(`log: ${input.state?.log}`)
}

const StartCommand = cmd({
  command: "start",
  describe: "start the local kilo daemon",
  builder: (yargs) => withJson(withNetworkOptions(yargs)),
  handler: async (args) => {
    const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
    warnPort(opts.port)
    const daemon = await Daemon.ensure(opts, explicitNetworkOptions())
    const result = daemon.result
    if (args.json) {
      print(result, true)
      return
    }
    console.log(
      result.reused
        ? "kilo daemon already running"
        : daemon.restarted
          ? "kilo daemon restarted"
          : "kilo daemon started",
    )
    print(result)
  },
})

const StatusCommand = cmd({
  command: "status",
  describe: "show local kilo daemon status",
  builder: (yargs) => withJson(yargs),
  handler: async (args) => {
    print(await Daemon.status(), Boolean(args.json))
  },
})

const StopCommand = cmd({
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
  builder: (yargs) => withJson(withNetworkOptions(yargs)),
  handler: async (args) => {
    const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
    warnPort(opts.port)
    const result = await Daemon.restart(opts)
    if (args.json) {
      print(result, true)
      return
    }
    console.log("kilo daemon restarted")
    print(result)
  },
})

export const DaemonCommand = cmd({
  command: "daemon",
  describe: "manage the local kilo daemon",
  builder: (yargs: Argv) =>
    yargs.command(StartCommand).command(StatusCommand).command(StopCommand).command(RestartCommand).demandCommand(),
  handler: async () => {},
})
