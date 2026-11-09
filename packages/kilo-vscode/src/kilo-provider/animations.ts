import * as vscode from "vscode"
import { getWebviewAnimations, type Animations } from "../utils"

/**
 * Reports the motion budget to the webview.
 *
 * The webview animates the status shimmer, the spinner, and the agent
 * avatars while a session works. Those animations tick on the main thread,
 * so a window that is in the background keeps a renderer busy at the display
 * refresh rate. The window state is reported alongside the setting because
 * the user never watches a chat they are not looking at.
 */
export function watchAnimations(
  post: (msg: { type: "animationsChanged"; animations: Animations; focused: boolean }) => void,
  next?: vscode.Disposable,
) {
  const report = () =>
    post({ type: "animationsChanged", animations: getWebviewAnimations(), focused: vscode.window.state.focused })
  const config = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.uiAnimations")) report()
  })
  const state = vscode.window.onDidChangeWindowState(report)
  return next ? vscode.Disposable.from(config, state, next) : vscode.Disposable.from(config, state)
}
