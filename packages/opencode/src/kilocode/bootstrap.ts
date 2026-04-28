import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloIndexing } from "@/kilocode/indexing"

export namespace KilocodeBootstrap {
  export async function init() {
    await Promise.all([KiloSessions.init(), KiloIndexing.init()])
  }
}
