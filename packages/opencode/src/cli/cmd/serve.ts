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
    const server = Server.listen(opts)
    console.log(`kilo server listening on http://${server.hostname}:${server.port}`) // kilocode_change
    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    const shutdown = async () => {
      try {
        // Race disposeAll against a 5s timeout so hung MCP subprocesses
        // cannot prevent the server from shutting down gracefully.
        await Promise.race([Instance.disposeAll(), new Promise<void>((resolve) => setTimeout(resolve, 5000))])
        await server.stop(true)
      } finally {
        abort.abort()
      }
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)
    // Orphan detection: exit if the parent process (extension host) dies.
    // Mirrors the pattern in tui/thread.ts to prevent zombie server processes
    // accumulating across extension restarts.
    const ppid = process.ppid
    const orphanCheck = setInterval(() => {
      try {
        process.kill(ppid, 0)
      } catch {
        clearInterval(orphanCheck)
        process.exit(143)
      }
    }, 1000)
    orphanCheck.unref()
    await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
    clearInterval(orphanCheck)
    // kilocode_change end
  },
})
