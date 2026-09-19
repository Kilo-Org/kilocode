import * as vscode from "vscode"

const CONFIG = "kilo-code.new"
const KEY = "diff.renderMarkdown"

export function getDiffMarkdownRender(): boolean {
  return vscode.workspace.getConfiguration(CONFIG).get<boolean>(KEY, false)
}

export async function setDiffMarkdownRender(value: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG).update(KEY, value, vscode.ConfigurationTarget.Global)
}

export type DiffStyle = "unified" | "split"

/**
 * The user's remembered unified/split choice for diff viewers. Undefined until
 * they toggle the style once — callers then fall back to their own defaults
 * (edit-tool diffs open split, permission-dock expand opens unified).
 */
export function getUserDiffStyle(): DiffStyle | undefined {
  const inspect = vscode.workspace.getConfiguration(CONFIG).inspect<DiffStyle>("diff.style")
  if (inspect?.globalValue === "unified" || inspect?.globalValue === "split") return inspect.globalValue
  return undefined
}

export async function setUserDiffStyle(style: DiffStyle): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG).update("diff.style", style, vscode.ConfigurationTarget.Global)
}
