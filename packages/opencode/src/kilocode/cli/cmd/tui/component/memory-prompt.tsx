import type { KiloClient } from "@kilocode/sdk/v2"
import type { DialogContext } from "@/cli/cmd/tui/ui/dialog"
import { DialogAlert } from "@/cli/cmd/tui/ui/dialog-alert"
import type { ToastContext } from "@/cli/cmd/tui/ui/toast"
import { showMemoryDialog } from "@/kilocode/cli/cmd/tui/component/dialog-memory"
import { MEMORY_USAGE, runMemoryCommand } from "@/kilocode/cli/cmd/tui/memory-command"

export namespace MemoryPrompt {
  export async function run(input: {
    text: string
    client: KiloClient
    workspace?: string
    directory?: string
    toast: ToastContext
    dialog: DialogContext
    done(): void
  }) {
    const handled = await runMemoryCommand({
      text: input.text,
      client: input.client,
      workspace: input.workspace,
      directory: input.directory,
      toast: input.toast,
      show: () => showMemoryDialog(input.dialog, { workspace: input.workspace, directory: input.directory }),
      usage: (message) => DialogAlert.show(input.dialog, "Memory", message || MEMORY_USAGE),
    })
    if (!handled) return false
    input.done()
    return true
  }
}
