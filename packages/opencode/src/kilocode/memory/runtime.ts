import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryInstance } from "@kilocode/kilo-memory/effect/instance"
import { MemoryLog } from "@kilocode/kilo-memory/effect/log"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { bind } from "@/kilocode/instance"
import { MemoryEvents } from "./events"

const log = Log.create({ service: "memory" })

let installed = false

/** Wire the package's injectable seams to opencode at process startup: the instance-context binder
 * (so async package calls survive the host ALS), the diagnostic logger, host paths (resolved from
 * Global, defaulting to ~/.kilo), and the Bus-backed event sink. Idempotent. */
export function installMemoryRuntime() {
  if (installed) return
  installed = true
  MemoryPaths.configure(() => ({ home: Global.Path.home, config: Global.Path.config }))
  MemoryInstance.setBinder((fn) => bind(fn))
  MemoryLog.setWarn((message, meta) => log.warn(message, meta))
  MemoryEvents.install()
}
