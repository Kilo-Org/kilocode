// kilocode_change - new file
import { cmd } from "./cmd"
import { buildInstanceAdvertisement } from "@/kilo-sessions/instance-advertisement"

// Re-export so existing unit tests that import from this module keep working.
export { buildInstanceAdvertisement }

// Keep the top-level import graph light: this module is registered eagerly at CLI
// startup, so implementation dependencies are imported inside the handler (same
// deferral pattern as upstream opencode#30453).
export const RemoteCommand = cmd({
  command: "remote",
  describe: "enable remote connection for real-time session relay",
  builder: (yargs) => yargs,
  handler: async () => {
    const { bootstrap } = await import("../bootstrap")
    const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
    const { context } = await import("@/project/instance-context")
    const { InstanceRuntime } = await import("@/project/instance-runtime")
    const { Instance } = await import("@/kilocode/instance")
    await bootstrap(process.cwd(), async () => {
      // kilocode_change - K1 W1: advertise this instance on the relay
      // heartbeat so the cloud side can show it as a spawn-capable instance.
      // The process-wide `KILO_REMOTE_ATTACH_SESSION` guard was removed in K1
      // (in-process sessions only; no spawned children), so this is always
      // advertised for the explicit `kilo remote` command path.
      // enableRemote() also ensures a default advertisement; this explicit call
      // remains a legitimate replace (or no-op when identical) per the contract.
      KiloSessions.setInstanceAdvertisement(buildInstanceAdvertisement(Instance.directory, "remote"))

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
