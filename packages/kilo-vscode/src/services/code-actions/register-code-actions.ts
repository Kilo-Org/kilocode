import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { getEditorContext } from "./editor-utils"
import { createPrompt } from "./support-prompt"

// Second step of "New Chat with Text" in the Command Palette. "No" comes first,
// so it is the default. Resolves to undefined when dismissed, which cancels the command.
async function askSend(): Promise<boolean | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "No", description: "Keep it in the prompt box so it can be edited first", send: false },
      { label: "Yes", description: "Send it right away", send: true },
    ],
    { placeHolder: "Send the message now?" },
  )
  return pick?.send
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
  activeTabProvider?: () => KiloProvider | undefined,
  lastFocusedChat?: () => KiloProvider | AgentManagerProvider | undefined,
): void {
  const target = () => (agentManager?.isActive() ? agentManager : (activeTabProvider?.() ?? provider))
  const reveal = async () => {
    await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
    await provider.waitForReady()
  }
  // Only the sidebar `provider` branch used to await readiness before
  // posting. An editor-tab webview or the Agent Manager panel can still be
  // opening/restoring when one of these commands fires, and postMessage()
  // does not queue — it silently drops the message if the webview hasn't
  // installed its listener yet. Wait for the selected target's own
  // readiness too before posting to it.
  //
  // AgentManagerProvider.waitForReady() resolves `false` instead of hanging
  // forever when the selected panel closes or is replaced while waiting.
  // Propagate that so callers skip posting instead of delivering the
  // message to whatever panel happens to be active by the time the wait
  // settles.
  const revealTarget = async (view: KiloProvider | AgentManagerProvider): Promise<boolean> => {
    if (view === provider) {
      await reveal()
      return true
    }
    if (view === agentManager) {
      return agentManager.waitForReady()
    }
    await view.waitForReady()
    return true
  }

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
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt, injectedTitle: "Explain selected code" })
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
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt, injectedTitle: "Fix code problems" })
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
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt, injectedTitle: "Improve selected code" })
    }),

    vscode.commands.registerCommand("kilo-code.new.addToContext", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const view = lastFocusedChat?.() ?? target()
      if (!(await revealTarget(view))) return
      view.postMessage({
        type: "appendChatContext",
        context: {
          id: crypto.randomUUID(),
          filePath: ctx.filePath,
          startLine: ctx.startLine,
          endLine: ctx.endLine,
          text: ctx.selectedText,
        },
      })
    }),

    vscode.commands.registerCommand("kilo-code.new.focusChatInput", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusInput" })
    }),

    // Other extensions call `executeCommand("kilo-code.new.newChatWithText", { text, send })`.
    // The text is put in the prompt box of a new chat as written. It is only
    // sent when `send` is true (default false). From the Command Palette there
    // is no argument, so ask for the text and then whether to send it. Unlike
    // terminalAddToContext, it works in hosts that cannot paste into a webview
    // (e.g. Theia).
    vscode.commands.registerCommand(
      "kilo-code.new.newChatWithText",
      async (args?: string | { text?: string; send?: boolean }) => {
        const given = typeof args === "string" ? { text: args } : (args ?? {})
        // Callers are other extensions, so don't trust the argument types.
        const preset = typeof given.text === "string" ? given.text : undefined
        const text = preset ?? (await vscode.window.showInputBox({ prompt: "Text to put in a new Kilo Code chat" }))
        if (!text?.trim()) return
        const send = typeof given.send === "boolean" ? given.send : preset === undefined ? await askSend() : false
        if (send === undefined) return
        const view = lastFocusedChat?.() ?? target()
        if (!(await revealTarget(view))) return
        view.postMessage({ type: "newChatWithText", text, ...(send ? { send } : {}) })
      },
    ),

    // Command Palette only — no keybinding. A keybinding would need to
    // route through VS Code's keybinding-to-focused-webview forwarding,
    // which doesn't reliably reach a webview whose own input already has
    // focus; invoking straight from the palette sidesteps that path
    // entirely, the same way terminalAddToContext etc. do. Toggles: the
    // webview closes the search bar itself if it's already open.
    vscode.commands.registerCommand("kilo-code.new.toggleChatSearch", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusSearch" })
    }),

    // The open-tabs switcher only exists in the sidebar and editor-tab chats;
    // Agent Manager has its own tab bar, so redirect it to the sidebar. Prefer
    // the last focused chat: an editor tab can still report active while the
    // user works in the sidebar.
    vscode.commands.registerCommand("kilo-code.new.showOpenTabs", async () => {
      const view = (() => {
        const last = lastFocusedChat?.()
        if (last) return last === agentManager ? provider : last
        if (agentManager?.isActive()) return provider
        return activeTabProvider?.() ?? provider
      })()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "showOpenTabs" })
    }),
  )
}
