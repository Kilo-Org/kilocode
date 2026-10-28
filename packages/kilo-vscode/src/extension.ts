import { homedir } from "node:os"
import { commands, ExtensionMode, window, workspace, type ExtensionContext } from "vscode"
import { chat } from "./chat"
import { command, manager } from "./server"
import { settings } from "./settings-panel"

export function activate(context: ExtensionContext) {
  const output = window.createOutputChannel("Kilo Code (v2)")
  const storage = context.globalStorageUri.fsPath
  const directory = workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir()
  const server = manager({
    command: () => command({ extension: context.extensionPath, storage, env: process.env }),
    cwd: directory,
    env: process.env,
    log: (text) => output.append(text),
    onError: (error) => {
      output.appendLine(error.message)
      void window.showErrorMessage(error.message.split("\n")[0], "Show Output").then((choice) => {
        if (choice) output.show()
      })
    },
  })
  const view = chat({ context, server, directory })
  const panel = settings({ context, server, directory })

  context.subscriptions.push(
    output,
    window.registerWebviewViewProvider("kilo-code.v2.chat", view.provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    commands.registerCommand("kilo-code.v2.newSession", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "newSession" })
    }),
    commands.registerCommand("kilo-code.v2.history", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "history" })
    }),
    commands.registerCommand("kilo-code.v2.profile", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "profile" })
    }),
    commands.registerCommand("kilo-code.v2.settings", () => panel.open()),
    panel,
    // The webview reconnects on its own: its event stream fails, and the next request starts a new server.
    commands.registerCommand("kilo-code.v2.restartServer", () => server.stop()),
    { dispose: () => void server.stop() },
  )

  // `bun run extension` opens a development host: show the chat right away.
  if (context.extensionMode === ExtensionMode.Development) void commands.executeCommand("kilo-code.v2.chat.focus")
}

export function deactivate() {}
