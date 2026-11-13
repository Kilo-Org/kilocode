// Project memory in the TUI: `/memory` with its dialogs, the sidebar Memory row and memory error toasts, on the
// `kilocode.memory` RPC served by the memory plugin in packages/kilo-plugin.
import { Plugin } from "@opencode/plugin/tui"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { MemoryTuiEvents } from "./memory-events"
import { memoryPalette } from "./plugins/memory-palette"
import { sidebarMemory } from "./plugins/memory-status"

export default Plugin.define({
  id: "kilocode.memory",
  setup(context) {
    memoryPalette(context)
    sidebarMemory(context)
    return MemoryTuiEvents.attach({
      event: context.client.rpc(KiloMemoryRpc.Definition).events,
      toast: context.ui.toast,
      sessionID: () => {
        const current = context.ui.router.current()
        return current.type === "session" ? current.sessionID : undefined
      },
    })
  },
})
