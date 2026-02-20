import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import { createPrompt } from "./support-prompt"

function getTerminalSelection(): string {
  const terminal = vscode.window.activeTerminal
  if (!terminal) return ""
  // VS Code terminal API doesn't expose buffer contents directly.
  // Terminal selection is available via clipboard in some cases.
  // For now, this is a placeholder — full implementation requires
  // VS Code shell integration API (terminal.shellIntegration).
  return ""
}

export function registerTerminalActions(context: vscode.ExtensionContext, provider: KiloProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.terminalAddToContext", () => {
      const content = getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_ADD_TO_CONTEXT", {
        terminalContent: content,
        userInput: "",
      })
      provider.postMessage({ type: "setChatBoxMessage", text: prompt })
      provider.postMessage({ type: "action", action: "focusInput" })
    }),

    vscode.commands.registerCommand("kilo-code.new.terminalFixCommand", () => {
      const content = getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_FIX", {
        terminalContent: content,
        userInput: "",
      })
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("kilo-code.new.terminalExplainCommand", () => {
      const content = getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_EXPLAIN", {
        terminalContent: content,
        userInput: "",
      })
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),
  )
}
