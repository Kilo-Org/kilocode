// kilocode_change - new file
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { Instance } from "@/project/instance"

export const RemoteCommand = cmd({
  command: "remote",
  describe: "enable remote connection for real-time session relay",
  builder: (yargs) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      await KiloSessions.enableRemote()
      console.log("Remote connection enabled.")

      const abort = new AbortController()
      const shutdown = async () => {
        try {
          KiloSessions.disableRemote()
          await Instance.dispose()
        } finally {
          abort.abort()
        }
      }
      process.on("SIGTERM", shutdown)
      process.on("SIGINT", shutdown)
      process.on("SIGHUP", shutdown)
      await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
    })
  },
})
