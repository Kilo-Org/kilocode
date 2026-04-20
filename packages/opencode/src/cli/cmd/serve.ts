import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance" // kilocode_change

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server", // kilocode_change
  handler: async (args) => {
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    console.log(`kilo server listening on http://${server.hostname}:${server.port}`)

    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    const shutdown = async () => {
      try {
        await Instance.disposeAll()
        await server.stop(true)
      } finally {
        abort.abort()
      }
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)

    // When spawned by the VS Code extension, stdin is kept open as a keepalive
    // pipe. If the extension host is hard-killed (crash, OOM) the write-end of
    // the pipe is closed by the OS, causing an EOF here. We detect that and
    // trigger a clean shutdown so no zombie process is left behind.
    //
    // Windows is excluded: detached child processes with a piped stdin on
    // Windows see an immediate EOF (the write-end is not held open the same
    // way), which would trigger shutdown() before the server can start.
    // On Windows the SIGTERM path in server-manager.ts is sufficient.
    if (process.env["KILO_CLIENT"] === "vscode" && process.platform !== "win32") {
      process.stdin.resume()
      process.stdin.on("end", () => {
        shutdown().catch(() => {})
      })
    }

    await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
    // kilocode_change end
  },
})
