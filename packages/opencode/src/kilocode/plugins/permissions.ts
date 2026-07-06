import type { TuiPlugin } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "@/cli/cmd/tui/plugin/internal"
import { MemoryPermission } from "@/kilocode/cli/cmd/tui/permissions"

const id = "internal:kilo-permissions"

const tui: TuiPlugin = async () => {
  MemoryPermission.register()
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
