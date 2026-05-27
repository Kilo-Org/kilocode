import * as vscode from "vscode"

const CONFIG = "kilo-code.new"
const KEY = "diff.renderMarkdown"

export function getDiffMarkdownRender(): boolean {
  return vscode.workspace.getConfiguration(CONFIG).get<boolean>(KEY, false)
}

export async function setDiffMarkdownRender(value: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG).update(KEY, value, vscode.ConfigurationTarget.Global)
}
