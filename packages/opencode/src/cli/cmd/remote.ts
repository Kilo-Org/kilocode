// kilocode_change - new file
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { buildInstanceAdvertisement } from "@/kilo-sessions/instance-advertisement"
import { context } from "@/project/instance-context"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Instance } from "@/kilocode/instance"

// Re-export so existing unit tests that import from this module keep working.
export { buildInstanceAdvertisement }

export const RemoteCommand = cmd({
  command: "remote",
  describe: "enable remote connection for real-time session relay",
  builder: (yargs) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      // kilocode_change - K1 W1: advertise this instance on the relay
      // heartbeat so the cloud side can show it as a spawn-capable instance.
      // The process-wide `KILO_REMOTE_ATTACH_SESSION` guard was removed in K1
      // (in-process sessions only; no spawned children), so this is always
      // advertised for the explicit `kilo remote` command path.
      // enableRemote() also ensures a default advertisement; this explicit call
      // remains a legitimate replace (or no-op when identical) per the contract.
      KiloSessions.setInstanceAdvertisement(buildInstanceAdvertisement(Instance.directory))

      await KiloSessions.enableRemote()
      console.log("Remote connection enabled.")

      const abort = new AbortController()
      const shutdown = async () => {
        try {
          KiloSessions.disableRemote()
          await InstanceRuntime.disposeInstance(context.use())
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
