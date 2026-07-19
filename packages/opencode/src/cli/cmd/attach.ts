import { cmd } from "./cmd"
import { Log } from "@opencode-ai/core/util/log" // kilocode_change
import { UI } from "@/cli/ui"
import { createKiloClient } from "@kilocode/sdk/v2" // kilocode_change
import { importCloudSession, validateCloudFork } from "@/kilocode/cloud-session" // kilocode_change
import { errorMessage } from "@opencode-ai/tui/util/error"
import { validateSession } from "../tui/validate-session"
import { ServerAuth } from "@/server/auth"

const log = Log.create({ service: "tui.attach" }) // kilocode_change

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running kilo server", // kilocode_change
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("cloud-fork", {
        type: "boolean",
        describe: "fetch session from cloud and continue locally (use with --session)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to KILO_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to KILO_SERVER_USERNAME or 'kilo')", // kilocode_change
      }),
  handler: async (args) => {
    const { TuiConfig } = await import("@/config/tui")
    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exitCode = 1
      return
    }

    // kilocode_change start
    const cloudForkError = validateCloudFork(args)
    if (cloudForkError) {
      UI.error(cloudForkError)
      process.exitCode = 1
      return
    }
    // kilocode_change end

    const directory = (() => {
      if (!args.dir) return undefined
      try {
        process.chdir(args.dir)
        return process.cwd()
      } catch {
        // If the directory doesn't exist locally (remote attach), pass it through.
        return args.dir
      }
    })()
    const headers = ServerAuth.headers({ password: args.password, username: args.username })
    // kilocode_change start - import cloud session before TUI renders
    if (args.cloudFork && args.session) {
      UI.println("Importing session from cloud...")
      const sdk = createKiloClient({
        baseUrl: args.url,
        directory,
        headers,
      })
      try {
        const id = await importCloudSession(sdk, args.session)
        args.session = id
        args.cloudFork = false
      } catch (err) {
        log.debug("failed to import cloud session", { err })
        UI.error(`Failed to import session from cloud: ${errorMessage(err)}`)
        process.exitCode = 1
        return
      }
    }
    // kilocode_change end
    const config = await TuiConfig.get()

    try {
      await validateSession({
        url: args.url,
        sessionID: args.session,
        directory,
        headers,
      })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
      return
    }

    const { Effect } = await import("effect")
    const { run } = await import("../tui/layer")
    const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
    await Effect.runPromise(
      run({
        url: args.url,
        config,
        pluginHost: createLegacyTuiPluginHost(),
        args: {
          continue: args.continue,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
      }),
    )
  },
})
