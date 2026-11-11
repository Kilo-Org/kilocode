import { commands, window, type ExtensionContext } from "vscode"
import { selectionAttachment } from "./attachments"
import { getEditorContext } from "./editor-utils"
import { createPrompt } from "./support-prompt"
import type { ChatTarget } from "./target"

export function registerCodeActions(context: ExtensionContext, target: ChatTarget): void {
  context.subscriptions.push(
    commands.registerCommand("kilo-code.v2.addToContext", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      await target.attach([selectionAttachment(ctx)])
    }),

    commands.registerCommand("kilo-code.v2.explainCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("EXPLAIN", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        userInput: "",
      })
      await target.prompt(prompt, [selectionAttachment(ctx)], "Explain selected code")
    }),

    commands.registerCommand("kilo-code.v2.fixCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("FIX", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        diagnostics: ctx.diagnostics.map((d) => ({
          source: d.source,
          message: d.message,
          code: typeof d.code === "object" ? d.code.value : d.code,
        })),
        userInput: "",
      })
      await target.prompt(prompt, [selectionAttachment(ctx)], "Fix code problems")
    }),

    commands.registerCommand("kilo-code.v2.improveCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("IMPROVE", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        userInput: "",
      })
      await target.prompt(prompt, [selectionAttachment(ctx)], "Improve selected code")
    }),

    commands.registerCommand("kilo-code.v2.focusChatInput", () => target.focus()),

    // Command Palette only — no keybinding. A keybinding would need to route
    // through VS Code's keybinding-to-focused-webview forwarding, which does
    // not reliably reach a webview whose own input already has focus;
    // invoking straight from the palette sidesteps that path. Toggles: the
    // webview closes the search bar itself if it is already open.
    commands.registerCommand("kilo-code.v2.toggleChatSearch", () => target.search()),

    commands.registerCommand("kilo-code.v2.generateTerminalCommand", async () => {
      const input = await window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await target.prompt("Generate a terminal command: " + input, undefined, "Generate terminal command")
    }),
  )
}
