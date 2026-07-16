import type { KiloClient } from "@kilocode/sdk/v2"
import type { CliRenderer } from "@opentui/core"
import type { DialogContext } from "@/cli/cmd/tui/ui/dialog"
import type { ToastContext } from "@/cli/cmd/tui/ui/toast"
import {
  showMemoryDialog,
  showMemoryHelpDialog,
  showMemoryStatusDialog,
} from "@/kilocode/cli/cmd/tui/component/dialog-memory"
import { runMemoryCommand } from "@/kilocode/cli/cmd/tui/memory-command"

export namespace MemoryPrompt {
  export async function run(input: {
    text: string
    client: KiloClient
    workspace?: string
    directory?: string
    sessionID?: string
    toast: ToastContext
    dialog: DialogContext
    renderer?: CliRenderer
    done(): void
  }) {
    const handled = await runMemoryCommand({
      text: input.text,
      client: input.client,
      workspace: input.workspace,
      directory: input.directory,
      sessionID: input.sessionID,
      toast: input.toast,
      renderer: input.renderer,
      show: () => showMemoryDialog(input.dialog, { workspace: input.workspace, directory: input.directory }),
      status: () => showMemoryStatusDialog(input.dialog, { workspace: input.workspace, directory: input.directory }),
      usage: (message) => showMemoryHelpDialog(input.dialog, message),
    })
    if (!handled) return false
    input.done()
    return true
  }
}
