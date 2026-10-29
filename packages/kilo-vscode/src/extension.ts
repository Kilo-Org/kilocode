import { homedir } from "node:os"
import { commands, ExtensionMode, window, workspace, type ExtensionContext } from "vscode"
import { chat } from "./chat"
import { command, manager, settingsEnvironment } from "./server"
import { readKiloSettings } from "./settings-host"
import { settings } from "./settings-panel"

export function activate(context: ExtensionContext) {
  const output = window.createOutputChannel("Kilo Code (v2)")
  const storage = context.globalStorageUri.fsPath
  const directory = workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir()
  // Read at each start, so a settings change applies to the next server.
  const serverSettings = () => {
    const values = readKiloSettings()
    return settingsEnvironment({
      claudeCodeCompat: values.claudeCodeCompat === true,
      extraCaCerts: typeof values.extraCaCerts === "string" ? values.extraCaCerts : "",
    })
  }
  const server = manager({
    command: () => command({ extension: context.extensionPath, storage, env: process.env }),
    cwd: directory,
    env: process.env,
    settings: serverSettings,
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
    // The host sends the action and the webview decides the next agent, as in main: the agent list and
    // the selection live in the webview, and only the server owns the committed value.
    commands.registerCommand("kilo-code.v2.cycleAgentMode", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "cycleAgentMode" })
    }),
    commands.registerCommand("kilo-code.v2.cyclePreviousAgentMode", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "cyclePreviousAgentMode" })
    }),
    // The webview reconnects on its own: its event stream fails, and the next request starts a new server.
    commands.registerCommand("kilo-code.v2.restartServer", () => server.stop()),
    // Claude Code compatibility and the extra CA certificates are server start environment, so a change needs a new
    // server. The next request starts one with the current settings.
    workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("kilo-code.v2.claudeCodeCompat") ||
        event.affectsConfiguration("kilo-code.v2.extraCaCerts")
      )
        void server.stop()
    }),
    { dispose: () => void server.stop() },
  )

  // `bun run extension` opens a development host: show the chat right away.
  if (context.extensionMode === ExtensionMode.Development) void commands.executeCommand("kilo-code.v2.chat.focus")
}

export function deactivate() {}
