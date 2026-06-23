import open from "open"
import type { Argv } from "yargs"
import { mkdir, rename, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { cmd } from "@/cli/cmd/cmd"
import {
  explicitNetworkOptions,
  withNetworkOptions,
  resolveNetworkOptions,
  resolveNetworkOptionsNoConfig,
} from "@/cli/network"
import { serverUrls } from "@/kilocode/cli/server-urls"
import { AppRuntime } from "@/effect/app-runtime"
import { Daemon } from "@/kilocode/daemon/daemon"
import { warnPort } from "@/kilocode/cli/port-warning"
import { hasDisplay } from "@/kilocode/cli/cmd/tui/util/display"
import { StopCommand } from "@/kilocode/cli/cmd/daemon"
import { Process } from "@/util/process"
import { Systemd } from "@/kilocode/cli/systemd"

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

const OpenCommand = cmd({
  command: "$0",
  describe: "open the local Kilo Console",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("foreground", {
      alias: "f",
      describe: "keep the command active until interrupted",
      type: "boolean",
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

const SERVICE_NAME = "kilo-console.service"
const DESCRIPTION = "Kilo Console daemon"

export type SystemctlResult = { code: number; stdout: string; stderr: string }
export type SystemctlRunner = (
  args: string[],
  scope?: "user" | "system",
) => Promise<SystemctlResult>

export const systemctlRunner: { current: SystemctlRunner } = {
  current: async (args, scope: "user" | "system" = "user") => {
    const cmd = scope === "user" ? ["systemctl", "--user", ...args] : ["systemctl", ...args]
    const out = await Process.run(cmd, { nothrow: true })
    return { code: out.code, stdout: out.stdout.toString(), stderr: out.stderr.toString() }
  },
}

const STOP_TIMEOUT_MS = 10_000
const stopTimeout: { current: number } = { current: STOP_TIMEOUT_MS }

async function stopWithTimeout(name: string, scope: "user" | "system"): Promise<SystemctlResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SystemctlResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          code: 124,
          stdout: "",
          stderr: `systemctl stop timed out after ${stopTimeout.current}ms`,
        }),
      stopTimeout.current,
    )
  })
  const result = await Promise.race([systemctlRunner.current(["stop", name], scope), timeout])
  clearTimeout(timer)
  return result
}

function requireSystemd(): boolean {
  if (Systemd.isAvailable()) return true
  console.error(
    "kilo console requires systemd. Support for other init systems is coming soon.",
  )
  process.exitCode = 1
  return false
}

function isRoot(): boolean {
  return process.platform !== "linux" || (typeof process.geteuid === "function" && process.geteuid() === 0)
}

function validateUnitName(name: string): void {
  if (!Systemd.isValidUnitName(name)) {
    throw new Error(
      `invalid --unit-name ${JSON.stringify(name)}; expected [a-zA-Z0-9][a-zA-Z0-9._-]*\\.service`,
    )
  }
}

function validateCors(origins: string[]): void {
  for (const origin of origins) {
    if (!Systemd.isValidCorsOrigin(origin)) {
      throw new Error(`invalid --cors ${JSON.stringify(origin)}; expected http(s) URL`)
    }
  }
}

function resolveExec(args: {
  binary: string[]
  hostname?: string
  port?: number
  mdns?: boolean
  "mdns-domain"?: string
  cors?: string[]
  extra?: string[]
}): string[] {
  const argv: string[] = [...args.binary, "console", "--foreground"]
  if (args.hostname !== undefined) argv.push("--hostname", args.hostname)
  if (args.port !== undefined) argv.push("--port", String(args.port))
  if (args.mdns) argv.push("--mdns")
  if (args["mdns-domain"]) argv.push("--mdns-domain", args["mdns-domain"])
  for (const origin of args.cors ?? []) argv.push("--cors", origin)
  if (args.extra) argv.push(...args.extra)
  return argv
}

function resolveBinary(): string[] {
  // When the current process is a node or bun interpreter wrapping the kilo
  // script (the normal production path for pnpm/npm installs and for `bun dev`),
  // invoke the interpreter with the real entry script directly. systemd does
  // not need a populated PATH to run an absolute path to node.
  const exec = process.execPath
  const entry = process.argv[1]
  if (entry && /node|bun/.test(exec ?? "")) return [exec, entry]
  if (exec) return [exec]
  const shim = Bun.which("kilo")
  return shim ? [shim] : ["kilo"]
}

const InstallCommand = cmd({
  command: "install",
  describe: "install Kilo Console as a systemd service",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("system", {
        describe: "install system-wide (/etc/systemd/system) instead of user scope",
        type: "boolean",
      })
      .option("unit-name", {
        describe: "override the systemd unit filename",
        type: "string",
        default: SERVICE_NAME,
      })
      .parserConfiguration({ "populate--": true }),
  handler: async (args) => {
    if (!requireSystemd()) return
    validateUnitName(args["unit-name"])
    const scope = Systemd.unitScope(args)
    if (scope === "system" && !isRoot()) {
      throw new Error("system install requires root; re-run with sudo")
    }
    const unitPath = scope === "system"
      ? Systemd.systemUnitPath(args["unit-name"])
      : Systemd.userUnitPath(args["unit-name"])

    const network = resolveNetworkOptionsNoConfig(args)
    validateCors(network.cors ?? [])
    const binary = resolveBinary()
    const argv = resolveExec({
      binary,
      hostname: network.hostname,
      port: network.port,
      mdns: network.mdns,
      "mdns-domain": network.mdnsDomain,
      cors: network.cors,
      extra: args["--"],
    })

    const unit = Systemd.renderUnit({
      description: DESCRIPTION,
      execStart: argv,
      user: scope === "user",
    })

    const tmp = unitPath + ".tmp"
    await mkdir(path.dirname(unitPath), { recursive: true })
    await writeFile(tmp, unit, "utf8")
    await rename(tmp, unitPath)

    const reload = await systemctlRunner.current(["daemon-reload"], scope)
    if (reload.code !== 0) throw new Error(`systemctl daemon-reload failed: ${reload.stderr || reload.stdout}`)

    const enable = await systemctlRunner.current(["enable", args["unit-name"]], scope)
    if (enable.code !== 0) throw new Error(`systemctl enable failed: ${enable.stderr || enable.stdout}`)

    const start = await systemctlRunner.current(["start", args["unit-name"]], scope)

    console.log(`Installed ${args["unit-name"]} (${scope})`)
    console.log(`  unit: ${unitPath}`)
    console.log(`  exec: ${binary.join(" ")} console …`)
    console.log(`  enabled: yes`)
    if (start.code === 0) {
      console.log(`  started: yes`)
    } else {
      console.warn(`  started: no (${start.stderr || start.stdout.trim()})`)
    }
    if (scope === "user") {
      console.log("View logs with: journalctl --user -u kilo-console -f")
      console.log("To enable persistence across logout, run: loginctl enable-linger $USER")
    } else {
      console.log("View logs with: journalctl -u kilo-console -f")
    }
  },
})

const UninstallCommand = cmd({
  command: "uninstall",
  describe: "remove the Kilo Console systemd service",
  builder: (yargs) =>
    yargs
      .option("system", {
        describe: "remove a system-wide unit instead of the user unit",
        type: "boolean",
      })
      .option("unit-name", {
        describe: "override the systemd unit filename",
        type: "string",
        default: SERVICE_NAME,
      }),
  handler: async (args) => {
    if (!requireSystemd()) return
    validateUnitName(args["unit-name"])
    const scope = Systemd.unitScope(args)
    const unitPath = scope === "system"
      ? Systemd.systemUnitPath(args["unit-name"])
      : Systemd.userUnitPath(args["unit-name"])

    if (!existsSync(unitPath)) {
      console.log(`not installed: ${unitPath}`)
      return
    }

    const stop = await stopWithTimeout(args["unit-name"], scope)
    if (stop.code !== 0) {
      console.warn(`  stop: no (${stop.stderr || stop.stdout.trim() || `exit ${stop.code}`})`)
    }
    await systemctlRunner.current(["disable", args["unit-name"]], scope)
    const { unlink } = await import("fs/promises")
    await unlink(unitPath)
    await systemctlRunner.current(["daemon-reload"], scope)

    console.log(`Removed ${args["unit-name"]} (${scope})`)
  },
})

const EnableCommand = cmd({
  command: "enable",
  describe: "enable Kilo Console systemd service to auto-start",
  builder: (yargs) =>
    yargs
      .option("system", { type: "boolean" })
      .option("unit-name", { type: "string", default: SERVICE_NAME }),
  handler: async (args) => {
    if (!requireSystemd()) return
    validateUnitName(args["unit-name"])
    const scope = Systemd.unitScope(args)
    const out = await systemctlRunner.current(["enable", args["unit-name"]], scope)
    if (out.code !== 0) throw new Error(out.stderr || out.stdout)
    console.log(`Enabled ${args["unit-name"]} (${scope})`)
  },
})

const DisableCommand = cmd({
  command: "disable",
  describe: "disable Kilo Console systemd service auto-start",
  builder: (yargs) =>
    yargs
      .option("system", { type: "boolean" })
      .option("unit-name", { type: "string", default: SERVICE_NAME }),
  handler: async (args) => {
    if (!requireSystemd()) return
    validateUnitName(args["unit-name"])
    const scope = Systemd.unitScope(args)
    const out = await systemctlRunner.current(["disable", args["unit-name"]], scope)
    if (out.code !== 0) throw new Error(out.stderr || out.stdout)
    console.log(`Disabled ${args["unit-name"]} (${scope})`)
  },
})

const IsEnabledCommand = cmd({
  command: "is-enabled",
  describe: "print whether the Kilo Console systemd service is enabled",
  builder: (yargs) =>
    yargs
      .option("system", { type: "boolean" })
      .option("unit-name", { type: "string", default: SERVICE_NAME }),
  handler: async (args) => {
    if (!requireSystemd()) return
    validateUnitName(args["unit-name"])
    const scope = Systemd.unitScope(args)
    const out = await systemctlRunner.current(["is-enabled", args["unit-name"]], scope)
    const state = (out.stdout || out.stderr).trim() || "unknown"
    console.log(state)
    if (out.code !== 0) process.exitCode = out.code
  },
})

export const __test__ = {
  resolveExec,
  resolveBinary,
  requireSystemd,
  validateUnitName,
  validateCors,
  stopTimeout,
  InstallCommand,
  UninstallCommand,
  EnableCommand,
  DisableCommand,
  IsEnabledCommand,
}

export const KiloConsoleCommand = cmd({
  command: "console",
  describe: "open or stop the local Kilo Console",
  builder: (yargs: Argv) =>
    yargs
      .command(OpenCommand)
      .command(StopCommand)
      .command(InstallCommand)
      .command(UninstallCommand)
      .command(EnableCommand)
      .command(DisableCommand)
      .command(IsEnabledCommand)
      .demandCommand(),
  handler: async () => {},
})
