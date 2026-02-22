import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { commands } from "./cli/commands" // kilocode_change
import { Log } from "./util/log"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@opencode-ai/util/error"
import { FormatError } from "./cli/error"
// import { GithubCommand } from "./cli/cmd/github" // kilocode_change
import { EOL } from "os"
// kilocode_change start - Import telemetry, instance disposal, and legacy migration
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Instance } from "./project/instance" // kilocode_change
import { migrateLegacyKiloAuth, ENV_FEATURE } from "@kilocode/kilo-gateway"

// kilocode_change - set feature for tracking. 'serve' is spawned by other services
// (extension, cloud) which set their own KILOCODE_FEATURE env var. Direct CLI use
// (any command other than 'serve') is tagged as 'cli'. If 'serve' is spawned without
// the env var, it gets 'unknown' so the misconfiguration is visible in data.
if (!process.env[ENV_FEATURE]) {
  const isServe = process.argv.includes("serve")
  process.env[ENV_FEATURE] = isServe ? "unknown" : "cli"
}
import { Global } from "./global"
import { Config } from "./config/config"
import { Auth } from "./auth"
// kilocode_change end

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("kilo") // kilocode_change
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"

    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    // kilocode_change start - Initialize telemetry
    const globalCfg = await Config.getGlobal()
    await Telemetry.init({
      dataPath: Global.Path.data,
      version: Installation.VERSION,
      enabled: globalCfg.experimental?.openTelemetry !== false,
    })

    // Migrate legacy Kilo CLI auth if needed
    await migrateLegacyKiloAuth(
      async () => (await Auth.get("kilo")) !== undefined,
      async (auth) => Auth.set("kilo", auth),
    )

    const kiloAuth = await Auth.get("kilo")
    if (kiloAuth) {
      const token = kiloAuth.type === "oauth" ? kiloAuth.access : kiloAuth.key
      const accountId = kiloAuth.type === "oauth" ? kiloAuth.accountId : undefined
      await Telemetry.updateIdentity(token, accountId)
    }

    Telemetry.trackCliStart()
    // kilocode_change end
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")

// kilocode_change start - use commands barrel
for (const command of commands) {
  cli.command(command as any)
}
// kilocode_change end
// .command(GithubCommand) // kilocode_change (Disabled until backend is ready)

cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e instanceof Error ? e.message : String(e))
  }
  process.exitCode = 1
} finally {
  // kilocode_change start - Track CLI exit and shutdown telemetry
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined
  Telemetry.trackCliExit(exitCode)
  await Telemetry.shutdown()
  // kilocode_change end

  await Instance.disposeAll() // kilocode_change - safety net disposal (no-op if already disposed)

  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
