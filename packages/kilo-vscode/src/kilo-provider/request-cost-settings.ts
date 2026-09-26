import * as vscode from "vscode"

type Post = (msg: unknown) => void

/** USD threshold for the expensive request notice. 0 disables the notice. */
export function requestCostNotice(): number {
  return vscode.workspace.getConfiguration("kilo-code.new").get<number>("requestCostNotice", 1)
}

/** Idle minutes before the cache expiry notice. 0 disables the notice. */
export function cacheIdleNotice(): number {
  return vscode.workspace.getConfiguration("kilo-code.new").get<number>("cacheIdleNotice", 5)
}

/** Push the cost notice settings to every webview when another surface changes them. */
export function watchRequestCostConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.requestCostNotice"))
      post({ type: "requestCostNoticeLoaded", value: requestCostNotice() })
    if (event.affectsConfiguration("kilo-code.new.cacheIdleNotice"))
      post({ type: "cacheIdleNoticeLoaded", value: cacheIdleNotice() })
  })
}
