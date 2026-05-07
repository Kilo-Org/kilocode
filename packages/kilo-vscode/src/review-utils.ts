import * as path from "path"
import * as vscode from "vscode"
import { inspect } from "util"

export function appendOutput(channel: vscode.OutputChannel, prefix: string, ...args: unknown[]): void {
  const msg = args
    .map((item) => (typeof item === "string" ? item : inspect(item, { breakLength: Infinity, depth: 4 })))
    .join(" ")
  channel.appendLine(`[${prefix}] ${msg}`)
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) return folders[0].uri.fsPath
  return undefined
}

export function openFileInEditor(
  filePath: string,
  line?: number,
  column?: number,
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
  prefix = "Kilo",
): void {
  const uri = vscode.Uri.file(filePath)
  const target = Math.max(1, Math.floor(line ?? 1))
  const col = column !== undefined && column > 0 ? column - 1 : 0
  const pos = new vscode.Position(target - 1, col)
  const selection = new vscode.Range(pos, pos)

  vscode.workspace.openTextDocument(uri).then(
    (doc) => vscode.window.showTextDocument(doc, { viewColumn, preview: true, selection }),
    (err) => console.error(`[Kilo New] ${prefix}: Failed to open file:`, uri.fsPath, err),
  )
}

export function openWorkspaceRelativeFile(relativePath: string, line?: number, column?: number): void {
  const root = getWorkspaceRoot()
  if (!root) return
  const resolved = path.resolve(root, relativePath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return
  openFileInEditor(resolved, line, column, vscode.ViewColumn.Beside, "DiffPanel")
}
