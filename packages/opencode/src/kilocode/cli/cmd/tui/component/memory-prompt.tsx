import type { KiloClient } from "@kilocode/sdk/v2"
import open from "open"
import type { DialogContext } from "@tui/ui/dialog"
import type { ToastContext } from "@tui/ui/toast"
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
    done(): void
  }) {
    const handled = await runMemoryCommand({
      text: input.text,
      client: input.client,
      workspace: input.workspace,
      directory: input.directory,
      sessionID: input.sessionID,
      toast: input.toast,
      inspect: async (root) => {
        await open(root)
      },
      show: () => showMemoryDialog(input.dialog, { workspace: input.workspace, directory: input.directory }),
      status: () => showMemoryStatusDialog(input.dialog, { workspace: input.workspace, directory: input.directory }),
      usage: (reason) =>
        showMemoryHelpDialog(input.dialog, { workspace: input.workspace, directory: input.directory, reason }),
    })
    if (!handled) return false
    input.done()
    return true
  }
}
