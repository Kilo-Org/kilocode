import * as vscode from "vscode"

type Post = (msg: unknown) => void

/** USD threshold for the expensive request notice. 0 disables the notice. */
export function requestCostNotice(): number {
  return vscode.workspace.getConfiguration("kilo-code.new").get<number>("requestCostNotice", 1)
}

/** Push the threshold to every webview when another surface changes it. */
export function watchRequestCostConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("kilo-code.new.requestCostNotice")) return
    post({ type: "requestCostNoticeLoaded", value: requestCostNotice() })
  })
}
