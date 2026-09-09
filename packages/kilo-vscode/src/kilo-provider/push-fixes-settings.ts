import * as vscode from "vscode"

/** Whether Agent Manager fix prompts ask the agent to commit and push so the pull request updates. */
export function pushFixes(): boolean {
  return vscode.workspace.getConfiguration("kilo-code.new.agentManager").get<boolean>("pushFixes", true)
}
