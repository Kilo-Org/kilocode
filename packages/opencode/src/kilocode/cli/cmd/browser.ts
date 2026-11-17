// `kilo browser-hub` (started by the browser or by a CLI) and `kilo browser install-host`.
import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"
import { errorMessage } from "@/util/error"
import { DefaultPort } from "@/kilocode/browser/protocol"

export const BrowserCommand = cmd({
  command: "browser",
  describe: "browser bridge utilities",
  builder: (yargs) => yargs.command(BrowserInstallHostCommand).demandCommand(),
  async handler() {},
})

const BrowserInstallHostCommand = cmd({
  command: "install-host",
  describe: "install the native messaging host for installed browsers",
  async handler() {
    try {
      const { install } = await import("@/kilocode/browser/install")
      const result = await install()
      for (const line of [result.shim, ...result.files, ...result.keys]) console.log(line)
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
    }
  },
})

export const BrowserHubCommand = cmd({
  command: "browser-hub [args..]",
  describe: "run the Kilo browser hub (started by the browser or the CLI)",
  builder: (yargs) =>
    yargs
      .option("native", { type: "boolean", describe: "speak native messaging framing on stdio" })
      .option("loopback", { type: "boolean", describe: "listen for the browser extension on a loopback WebSocket" })
      .option("port", { type: "number", default: DefaultPort, describe: "loopback WebSocket port" })
      // Chrome also passes the calling origin and, on Windows, --parent-window; the
      // browser owns those arguments, so this command does not reject them.
      .strict(false),
  async handler(args) {
    const native = args.native === true
    if (native === (args.loopback === true)) {
      UI.error("choose exactly one of --native or --loopback")
      process.exitCode = 1
      return
    }
    try {
      if (native) {
        const { run } = await import("@/kilocode/browser/native")
        // Identity arguments arrive after the flags; the hub validates them.
        await run({ argv: process.argv.slice(2).filter((arg) => !arg.startsWith("-")) })
        return
      }
      const { run } = await import("@/kilocode/browser/loopback")
      await run({ port: typeof args.port === "number" ? args.port : DefaultPort })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
    }
  },
})
