// kilocode_change - new file
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { context } from "@/project/instance-context"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Instance } from "@/kilocode/instance"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import os from "node:os"
import path from "node:path"

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

// kilocode_change start - K1 W1: extracted so the advertisement payload shape
// is unit-testable as real behavior, rather than only through a source-text/
// regex assertion on this file (the handler itself can't be driven end-to-end
// — see the doc comment on `handler` below).
export function buildInstanceAdvertisement(directory: string): {
  name: string
  projectName: string
  version: string
} {
  return {
    name: truncate(os.hostname(), 64),
    projectName: truncate(path.basename(directory) || directory, 64),
    version: truncate(InstallationVersion, 32),
  }
}
// kilocode_change end

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
