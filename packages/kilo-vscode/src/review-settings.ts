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
 * The user's remembered unified/split choice for diff viewers, read from the
 * effective configuration so a workspace override applies. Undefined until the
 * style is set once; callers then fall back to their own defaults (edit-tool
 * diffs open split, permission-dock expand opens unified).
 */
export function getUserDiffStyle(): DiffStyle | undefined {
  const value = vscode.workspace.getConfiguration(CONFIG).get<DiffStyle>("diff.style")
  if (value === "unified" || value === "split") return value
  return undefined
}

export async function setUserDiffStyle(style: DiffStyle): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG).update("diff.style", style, vscode.ConfigurationTarget.Global)
}
