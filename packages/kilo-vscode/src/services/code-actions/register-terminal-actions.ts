import { commands, window, type ExtensionContext } from "vscode"
import { getTerminalContents } from "../terminal/context"
import { terminalAttachment } from "./attachments"
import { createPrompt } from "./support-prompt"
import type { ChatTarget } from "./target"

const NO_CONTENT = "No terminal content available. Select text in the terminal first."

type TerminalArgs = { selection?: string } | undefined

export function registerTerminalActions(context: ExtensionContext, target: ChatTarget): void {
  context.subscriptions.push(
    commands.registerCommand("kilo-code.v2.terminalAddToContext", async (args: TerminalArgs) => {
      const output = args?.selection ? { content: args.selection, truncated: false } : await getTerminalContents(-1)
      if (!output.content) {
        void window.showInformationMessage(NO_CONTENT)
        return
      }
      await target.attach([terminalAttachment(output)])
    }),

    commands.registerCommand("kilo-code.v2.terminalFixCommand", async (args: TerminalArgs) => {
      const content = args?.selection ?? (await getTerminalContents(1)).content
      if (!content) {
        void window.showInformationMessage(NO_CONTENT)
        return
      }
      await target.prompt(
        createPrompt("TERMINAL_FIX", { terminalContent: content, userInput: "" }),
        undefined,
        "Fix terminal command",
      )
    }),

    commands.registerCommand("kilo-code.v2.terminalExplainCommand", async (args: TerminalArgs) => {
      const content = args?.selection ?? (await getTerminalContents(1)).content
      if (!content) {
        void window.showInformationMessage(NO_CONTENT)
        return
      }
      await target.prompt(
        createPrompt("TERMINAL_EXPLAIN", { terminalContent: content, userInput: "" }),
        undefined,
        "Explain terminal command",
      )
    }),
  )
}
