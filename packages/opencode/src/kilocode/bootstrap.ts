import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import path from "node:path"
import { Bus } from "@/bus"
import { SessionExport } from "@/kilocode/session-export"

const log = Log.create({ service: "kilocode-bootstrap" })

export namespace KilocodeBootstrap {
  export async function init() {
    await KiloSessions.init()
    SessionExport.init({
      agentVersion: InstallationVersion,
      dbPath: path.join(Global.Path.data, "session-export.db"),
      subscribeAll: (cb) => Bus.subscribeAll(cb),
    })
    void import("@/kilocode/indexing")
      .then((mod) => mod.KiloIndexing.init())
      .catch((err) => log.warn("indexing bootstrap failed", { err }))
  }
}
