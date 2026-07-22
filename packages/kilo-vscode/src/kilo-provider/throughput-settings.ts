import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildThroughputSettingMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  return {
    type: "throughputSettingLoaded" as const,
    visible: config.get<boolean>("showTokenThroughput", false),
  }
}

export function watchThroughputConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.showTokenThroughput")) {
      post(buildThroughputSettingMessage())
    }
  })
}

export function validThroughputSetting(key: string, value: unknown) {
  return key === "showTokenThroughput" && typeof value === "boolean"
}
