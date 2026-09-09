import * as vscode from "vscode"

type Post = (msg: unknown) => void

/** Whether Agent Manager fix prompts ask the agent to commit and push so the pull request updates. */
export function pushFixes(): boolean {
  return vscode.workspace.getConfiguration("kilo-code.new.agentManager").get<boolean>("pushFixes", true)
}

export function buildPushFixesSettingMessage() {
  return {
    type: "pushFixesSettingLoaded" as const,
    enabled: pushFixes(),
  }
}

/** Push the setting to every webview when another surface changes it. */
export function watchPushFixesConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("kilo-code.new.agentManager.pushFixes")) return
    post(buildPushFixesSettingMessage())
  })
}
