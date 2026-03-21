import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance" // kilocode_change
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { resolve } from "path"

async function ensureAppBuilt() {
  const appDist = resolve(fileURLToPath(new URL("../../../app/dist", import.meta.url)), "index.html")
  if (await Filesystem.exists(appDist)) return

  console.log("Building web UI...")
  try {
    const bunPath = process.env.BUN_INSTALL?.concat("/bin/bun") || "/root/.bun/bin/bun"
    const proc = Bun.spawn({
      cmd: [bunPath, "run", "build"],
      cwd: resolve(fileURLToPath(new URL("../../../app", import.meta.url))),
      stdout: "inherit",
      stderr: "inherit",
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      console.log("Warning: Web UI build failed. Server will start but web UI may not be available.")
      return
    }
    console.log("Web UI built successfully")
  } catch (err) {
    console.log("Warning: Could not build web UI automatically:", (err as Error).message)
    console.log("To enable the web UI, run: cd packages/app && bun run build")
  }
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server", // kilocode_change
  handler: async (args) => {
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    await ensureAppBuilt()
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`kilo server listening on http://${server.hostname}:${server.port}`)

    let workspaceSync: Array<ReturnType<typeof Workspace.startSyncing>> = []
    // Only available in development right now
    if (Installation.isLocal()) {
      workspaceSync = Project.list().map((project) => Workspace.startSyncing(project))
    }

    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    const shutdown = async () => {
      try {
        await Instance.disposeAll()
        await server.stop(true)
        await Promise.all(workspaceSync.map((item) => item.stop()))
      } finally {
        abort.abort()
      }
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)
    await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
    // kilocode_change end
  },
})
