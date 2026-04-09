import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { createPrompt } from "./support-prompt"

/**
 * Read terminal content via clipboard.
 * When `commands` is negative, selects all terminal content.
 * When positive, selects the last N commands.
 */
async function getTerminalContents(commands = -1): Promise<string> {
  const saved = await vscode.env.clipboard.readText()

  try {
    if (commands < 0) {
      await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
    } else {
      for (let i = 0; i < commands; i++) {
        await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
      }
    }

    await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
    await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

    let content = (await vscode.env.clipboard.readText()).trim()

    await vscode.env.clipboard.writeText(saved)

    if (saved === content) {
      return ""
    }

    // Trim duplicate trailing prompt line
    const lines = content.split("\n")
    const last = lines.pop()?.trim()
    if (last) {
      let i = lines.length - 1
      while (i >= 0 && !lines[i].trim().startsWith(last)) {
        i--
      }
      content = lines.slice(Math.max(i, 0)).join("\n")
    }

    return content
  } catch (err) {
    await vscode.env.clipboard.writeText(saved)
    throw err
  }
}

export function registerTerminalActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
): void {
  const target = () => (agentManager?.isActive() ? agentManager : provider)

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.terminalAddToContext", async (args: any) => {
      let content = args?.selection as string | undefined
      if (!content) {
        content = await getTerminalContents(-1)
      }
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

    vscode.commands.registerCommand("kilo-code.new.terminalFixCommand", async (args: any) => {
      let content = args?.selection as string | undefined
      if (!content) {
        content = await getTerminalContents(1)
      }
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

    vscode.commands.registerCommand("kilo-code.new.terminalExplainCommand", async (args: any) => {
      let content = args?.selection as string | undefined
      if (!content) {
        content = await getTerminalContents(1)
      }
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
