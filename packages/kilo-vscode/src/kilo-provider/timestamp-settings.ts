import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildTimestampSettingMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  return {
    type: "timestampSettingLoaded" as const,
    visible: config.get<boolean>("showMessageTimestamp", true),
  }
}

export function watchTimestampConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.showMessageTimestamp")) {
      post(buildTimestampSettingMessage())
    }
  })
}
