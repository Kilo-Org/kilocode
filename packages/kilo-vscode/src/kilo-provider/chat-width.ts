import * as vscode from "vscode"
import { getChatContentWidthLimit } from "../utils"

export function watchChatContentWidthConfig(
  post: (msg: { type: "chatContentWidthLimitChanged"; limited: boolean }) => void,
  next?: vscode.Disposable,
) {
  const width = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.limitChatContentWidth")) {
      post({ type: "chatContentWidthLimitChanged", limited: getChatContentWidthLimit() })
    }
  })
  return next ? vscode.Disposable.from(width, next) : width
}
