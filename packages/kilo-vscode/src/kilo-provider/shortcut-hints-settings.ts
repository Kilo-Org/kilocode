import * as vscode from "vscode"

type Post = (msg: unknown) => void

/** Whether the prompt and empty Agent Manager sessions show keyboard shortcut hints. */
export function shortcutHints(): boolean {
  return vscode.workspace.getConfiguration("kilo-code.new").get<boolean>("showShortcutHints", true)
}

export function buildShortcutHintsSettingMessage() {
  return {
    type: "shortcutHintsSettingLoaded" as const,
    visible: shortcutHints(),
  }
}

/** Push the setting to every webview when another surface changes it. */
export function watchShortcutHintsConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("kilo-code.new.showShortcutHints")) return
    post(buildShortcutHintsSettingMessage())
  })
}
