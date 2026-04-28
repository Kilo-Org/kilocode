import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { Log } from "@/util"

const log = Log.create({ service: "kilocode-bootstrap" })

export namespace KilocodeBootstrap {
  export async function init() {
    await KiloSessions.init()
    void import("@/kilocode/indexing")
      .then((mod) => mod.KiloIndexing.init())
      .catch((err) => log.warn("indexing bootstrap failed", { err }))
  }
}
