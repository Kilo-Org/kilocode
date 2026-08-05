import type { Argv } from "yargs"
import * as Log from "@opencode-ai/core/util/log"
import { InstallationBuildKind, InstallationVersion } from "@opencode-ai/core/installation/version"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { createHelpCommand } from "@/kilocode/help-command"
import { KiloConsoleCommand } from "@/kilocode/cli/cmd/console"
import { CloudCommand } from "@/kilocode/cli/cmd/cloud"
import { RollCallCommand } from "@/kilocode/cli/cmd/roll-call"
import { ProfileCommand } from "@/kilocode/cli/cmd/profile"
import { DaemonCommand } from "@/kilocode/cli/cmd/daemon"
import { DevSetupCommand, DevAliasCommand } from "@/kilocode/cli/dev-setup"
import { RemoteCommand } from "@/cli/cmd/remote"
import { ConfigCommand as ConfigCLICommand } from "@/cli/cmd/config"

const log = Log.create({ service: "kilocode.cli" })

// Process-level ingest drain for non-TUI commands (`kilo run`, etc.).
// KiloCli.shutdown() runs KiloShutdown before disposeAllInstances — preserve that order.
// Registered at setup load time (not inside shutdown()) so the task is always present.
// Dynamic import keeps setup.ts's own static import graph unchanged: consumers that load
// setup.ts under partial module mocks (e.g. cli-shutdown tests whose @/auth mock omits
// OAUTH_DUMMY_KEY) would otherwise fail to link the provider/plugin chain. Dynamic import
// returns the same in-process module singleton, so the drained queue is the one that
// received events. Task try/catch covers dynamic-import failure outside the shared drain
// guard; the drain itself never rejects.
KiloShutdown.register(async () => {
  try {
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
    await KiloSessions.drainIngestForShutdown()
  } catch (err) {
    log.warn("ingest drain failed", { err })
  }
})

// All Kilo-specific CLI customization lives here so the shared upstream entrypoint
// (src/index.ts) only needs a handful of thin call-sites behind kilocode_change markers.
// This keeps index.ts close to upstream and reduces merge conflicts on every sync.
//
// Startup cost note: this module is imported eagerly from src/index.ts, so its static
// import graph must stay light. Heavy dependencies (telemetry, gateway auth migration,
// AppRuntime, config, auth, session-export, JSON migration) are dynamically imported
// inside the function that needs them, following the deferral pattern upstream applied
// in opencode#30453. The registered command modules must follow the same rule: a light
// top level, with implementation imports inside their handlers.
export namespace KiloCli {
  let info = false

  // Register only the Kilo-specific commands. Upstream commands stay in index.ts's chain so
  // upstream merges that add or remove commands keep working without touching this file.
  export function register<T>(cli: Argv<T>): Argv<T> {
    cli
      .command(KiloConsoleCommand)
      .command(CloudCommand)
      .command(RollCallCommand)
      .command(ProfileCommand)
      .command(RemoteCommand)
      .command(DaemonCommand)
      .command(ConfigCLICommand)
    if (InstallationBuildKind !== "release") cli.command(DevSetupCommand).command(DevAliasCommand)
    // Safe self-reference: `cli` is a typed parameter and yargs `.command()` returns the same
    // instance, so the help command can resolve the fully-built root at handler time. This also
    // sidesteps the self-referential type error the old inline registration hit in index.ts.
    cli.command(createHelpCommand(() => cli))
    return cli
  }

  export async function runner() {
    if (!process.argv.includes("__background-process-runner")) return false
    return (await import("@/kilocode/background-process/runner")).BackgroundProcessRunner.maybe()
  }

  // Runs from the upstream `.middleware`, before any command handler. Env tagging is additive so
  // it never has to modify upstream's own env assignments.
  export async function bootstrap(opts: { [key: string]: unknown }): Promise<void> {
    info = opts.help === true || opts.version === true
    if (info) return

    const { KiloLog } = await import("@/kilocode/log")
    await KiloLog.init()

    const gateway = await import("@kilocode/kilo-gateway")
    if (!process.env[gateway.ENV_FEATURE])
      process.env[gateway.ENV_FEATURE] = process.argv.includes("serve") ? "unknown" : "cli"
    if (!process.env[gateway.ENV_VERSION]) process.env[gateway.ENV_VERSION] = InstallationVersion
    process.env.KILO = "1"

    // Must run before AppRuntime initializes the SQLite database, or the marker
    // exists before legacy JSON can be imported.
    const { JsonMigration } = await import("@/kilocode/storage/json-migration")
    await JsonMigration.bootstrap()

    const { AppRuntime } = await import("@/effect/app-runtime")
    const { Config } = await import("@/config/config")
    const cfg = await AppRuntime.runPromise(Config.Service.use((c) => c.getGlobal()))

    const { Global } = await import("@opencode-ai/core/global")
    const { Telemetry } = await import("@kilocode/kilo-telemetry")
    await Telemetry.init({
      dataPath: Global.Path.data,
      version: InstallationVersion,
      enabled: cfg.experimental?.openTelemetry !== false,
    })

    const { Auth } = await import("@/auth")
    const { migrateLegacyKiloAuth } = gateway

    // Migrate legacy Kilo CLI auth (~/.kilocode/cli/config.json) into auth.json if present.
    await migrateLegacyKiloAuth(
      async () => (await AppRuntime.runPromise(Auth.Service.use((s) => s.get("kilo")))) !== undefined,
      async (auth) => AppRuntime.runPromise(Auth.Service.use((s) => s.set("kilo", auth))),
    )

    const auth = await AppRuntime.runPromise(Auth.Service.use((s) => s.get("kilo")))
    if (auth) {
      const token = auth.type === "oauth" ? auth.access : auth.key
      const account = auth.type === "oauth" ? auth.accountId : undefined
      await Telemetry.updateIdentity(token, account)
    }

    Telemetry.trackCliStart()
    // Overlap the event upload with command execution so exit is not delayed by
    // a network round trip (#10242).
    Telemetry.flushInBackground()
  }

  // Runs from the `finally` block on every exit path.
  export async function shutdown(): Promise<void> {
    if (info) return
    const { Telemetry } = await import("@kilocode/kilo-telemetry")
    const code = typeof process.exitCode === "number" ? process.exitCode : undefined
    Telemetry.trackCliExit(code)
    const { SessionExport } = await import("@/kilocode/session-export")
    try {
      await SessionExport.shutdown()
      // Bound telemetry shutdown so an unreachable endpoint (offline, firewall,
      // DNS adblock resolving the host to 0.0.0.0) cannot block process exit on
      // short-lived commands like `kilo --help` / `kilo --version` (#9788).
      try {
        await Telemetry.shutdown(2000)
      } catch (err) {
        log.warn("telemetry shutdown failed", { err })
      }
    } finally {
      await KiloShutdown.run()
      const { InstanceRuntime } = await import("@/project/instance-runtime")
      await InstanceRuntime.disposeAllInstances() // safety net (no-op if already disposed)
    }
  }
}
