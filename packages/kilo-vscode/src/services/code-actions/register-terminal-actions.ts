import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { createPrompt } from "./support-prompt"

async function getTerminalSelection(): Promise<string> {
  const terminal = vscode.window.activeTerminal
  if (!terminal) return ""
  // VS Code terminal API doesn't expose selection text directly.
  // Copy the terminal selection to clipboard, read it, then restore.
  const previous = await vscode.env.clipboard.readText()
  await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
  const selection = await vscode.env.clipboard.readText()
  // Restore original clipboard content if it changed
  if (selection !== previous) {
    await vscode.env.clipboard.writeText(previous)
  }
  // If clipboard didn't change, nothing was selected
  if (selection === previous) return ""
  return selection
}

export function registerTerminalActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
): void {
  const target = () => (agentManager?.isActive() ? agentManager : provider)

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.terminalAddToContext", async () => {
      const content = await getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_ADD_TO_CONTEXT", {
        terminalContent: content,
        userInput: "",
      })
      target().postMessage({ type: "appendChatBoxMessage", text: prompt })
      target().postMessage({ type: "action", action: "focusInput" })
    }),

    vscode.commands.registerCommand("kilo-code.new.terminalFixCommand", async () => {
      const content = await getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_FIX", {
        terminalContent: content,
        userInput: "",
      })
      target().postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("kilo-code.new.terminalExplainCommand", async () => {
      const content = await getTerminalSelection()
      if (!content) {
        vscode.window.showInformationMessage("No terminal content available. Select text in the terminal first.")
        return
      }
      const prompt = createPrompt("TERMINAL_EXPLAIN", {
        terminalContent: content,
        userInput: "",
      })
      target().postMessage({ type: "triggerTask", text: prompt })
    }),
  )
}
