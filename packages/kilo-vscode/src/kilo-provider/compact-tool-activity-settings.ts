import * as vscode from "vscode"

type Post = (msg: unknown) => void

/**
 * Experimental transcript density flag. Off means the sidebar renders every tool
 * call and thought as its own card, which is the behavior every existing session
 * has today. On means consecutive tool/reasoning parts collapse into one
 * summarized activity row that can be expanded back into the same cards.
 */
export function buildCompactToolActivityMessage() {
  const cfg = vscode.workspace.getConfiguration("kilo-code.new.experimental")
  return {
    type: "compactToolActivitySettingLoaded" as const,
    enabled: cfg.get<boolean>("compactToolActivity", false),
  }
}

export function watchCompactToolActivityConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.experimental.compactToolActivity")) {
      post(buildCompactToolActivityMessage())
    }
  })
}
