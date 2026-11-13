import type { Plugin } from "@opencode/plugin/tui"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { usePromptRef } from "../../context/prompt"
import { emptyPrompt } from "../../prompt/history"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { MemoryPrompt } from "../memory-prompt"

/** `/memory` (alias `/mem`): without arguments it opens the memory help dialog, with arguments it runs the operation. */
export function memoryPalette(context: Plugin.Context) {
  return context.ui.slot({
    append: "app",
    render() {
      const dialog = useDialog()
      const toast = useToast()
      const prompt = usePromptRef()
      const rpc = context.client.rpc(KiloMemoryRpc.Definition)
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "kilo.memory.help",
            title: "Memory",
            description: "Manage project memory",
            group: "System",
            palette: true,
            slash: { name: "memory", aliases: ["mem"], arguments: true },
            async run(input) {
              const current = context.ui.router.current()
              const sessionID = current.type === "session" ? current.sessionID : undefined
              const location =
                (sessionID ? context.data.session.get(sessionID)?.location : undefined) ??
                context.location ??
                context.data.location.default()
              await MemoryPrompt.run({
                text: `/memory ${input ?? ""}`,
                rpc,
                directory: location.directory,
                sessionID,
                toast,
                dialog,
                draft: (text) => {
                  prompt.current?.set({ ...emptyPrompt(), text })
                  prompt.current?.focus()
                },
              })
            },
          },
        ],
      }))
      return null
    },
  })
}
