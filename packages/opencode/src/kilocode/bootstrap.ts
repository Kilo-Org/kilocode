import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { Log } from "@/util"

const log = Log.create({ service: "kilocode-bootstrap" })

export namespace KilocodeBootstrap {
  export async function init() {
    warmup()
    await KiloSessions.init()
    void import("@/kilocode/indexing")
      .then((mod) => mod.KiloIndexing.init())
      .catch((err) => log.warn("indexing bootstrap failed", { err }))
  }

  function warmup() {
    void import("@/tool/registry")
      .then((mod) => mod.ids())
      .catch((err) => log.warn("tool registry warmup failed", { err }))
  }
}
