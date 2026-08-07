import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildChatSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.chat")
  return {
    type: "chatSettingsLoaded" as const,
    settings: {
      shiftTabCyclesVariant: config.get<boolean>("shiftTabCyclesVariant", true),
      limitContentWidth: config.get<boolean>("limitContentWidth", true),
    },
  }
}

export function watchChatConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.chat")) {
      post(buildChatSettingsMessage())
    }
  })
}

export function validChatSetting(key: string, value: unknown) {
  return (key === "shiftTabCyclesVariant" || key === "limitContentWidth") && typeof value === "boolean"
}
