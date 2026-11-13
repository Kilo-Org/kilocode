import { openPath } from "@opencode/util/open"
import type { DialogContext } from "../ui/dialog"
import { showMemoryDialog, showMemoryHelpDialog, showMemoryStatusDialog } from "./components/dialog-memory"
import { runMemoryCommand, type MemoryRpc } from "./memory-command"

type Toast = {
  show(input: { message: string; variant: "error" | "info" | "success" }): void
}

export namespace MemoryPrompt {
  /** Runs a typed `/memory ...` prompt. Returns false when the text is not a memory command. */
  export async function run(input: {
    text: string
    rpc: MemoryRpc
    directory: string
    sessionID?: string
    toast: Toast
    dialog: DialogContext
    draft(text: string): void
  }) {
    return runMemoryCommand({
      text: input.text,
      rpc: input.rpc,
      directory: input.directory,
      sessionID: input.sessionID,
      toast: input.toast,
      inspect: async (root) => {
        await openPath(root)
      },
      show: () => showMemoryDialog(input.dialog, { directory: input.directory }),
      status: () => showMemoryStatusDialog(input.dialog, { directory: input.directory }),
      usage: (reason) => showMemoryHelpDialog(input.dialog, { directory: input.directory, reason, draft: input.draft }),
    })
  }
}
