import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { getEditorContext } from "./editor-utils"
import { createPrompt } from "./support-prompt"

const SIDEBAR_FOCUS_COMMAND = "kilo-code.SidebarProvider.focus"

async function postTask(provider: KiloProvider, prompt: string): Promise<void> {
  // Editor quick fixes always target the sidebar so the behavior is consistent
  // regardless of whether Agent Manager is currently open.
  await vscode.commands.executeCommand(SIDEBAR_FOCUS_COMMAND)
  await provider.waitForReady()
  provider.postMessage({ type: "triggerTask", text: prompt })
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
): void {
  // agentManager is only respected by commands that call target():
  // - addToContext (routes to agentManager if active, else provider)
  // - focusChatInput (same routing)
  // Commands explainCode, fixCode, and improveCode always route through provider (KiloProvider)
  // and do not respect agentManager — they use postTask() which always targets the sidebar.
  const target = () => (agentManager?.isActive() ? agentManager : provider)

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.explainCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("EXPLAIN", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await postTask(provider, prompt)
    }),

    vscode.commands.registerCommand("kilo-code.new.fixCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("FIX", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        diagnostics: ctx.diagnostics,
        userInput: "",
      })
      await postTask(provider, prompt)
    }),

    vscode.commands.registerCommand("kilo-code.new.improveCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("IMPROVE", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await postTask(provider, prompt)
    }),

    vscode.commands.registerCommand("kilo-code.new.addToContext", () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("ADD_TO_CONTEXT", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
      })
      target().postMessage({ type: "appendChatBoxMessage", text: prompt })
    }),

    vscode.commands.registerCommand("kilo-code.new.focusChatInput", () => {
      target().postMessage({ type: "action", action: "focusInput" })
    }),
  )
}
