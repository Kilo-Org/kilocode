import * as vscode from "vscode"
import { isAbsolutePath } from "../path-utils"

/**
 * Stat-check candidate paths and return which ones are actual files (not directories).
 */
export function validateFiles(root: string, paths: string[]): Promise<string[]> {
  const resolve = (p: string) =>
    isAbsolutePath(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(vscode.Uri.file(root), p)
  return Promise.all(
    paths.map((p) =>
      vscode.workspace.fs.stat(resolve(p)).then(
        (s) => (s.type & vscode.FileType.File ? p : null),
        () => null,
      ),
    ),
  ).then((r) => r.filter((x): x is string => x !== null))
}

/**
 * Open a file in the editor with optional line/column positioning.
 * Falls back to a workspace-wide filename search if the exact path doesn't exist.
 */
export function openFile(root: string, filePath: string, line?: number, column?: number): void {
  const uri = isAbsolutePath(filePath)
    ? vscode.Uri.file(filePath)
    : vscode.Uri.joinPath(vscode.Uri.file(root), filePath)
  const opts: vscode.TextDocumentShowOptions = { preview: true }
  if (line !== undefined && line > 0) {
    const pos = new vscode.Position(line - 1, column !== undefined && column > 0 ? column - 1 : 0)
    opts.selection = new vscode.Range(pos, pos)
  }
  const show = (target: vscode.Uri) =>
    vscode.workspace.openTextDocument(target).then(
      (doc) => vscode.window.showTextDocument(doc, opts),
      (err) => console.error("[Kilo New] openFile show failed:", err),
    )
  vscode.workspace.fs.stat(uri).then(
    () => show(uri),
    () => {
      const name = filePath.split(/[\\/]/).pop() || filePath
      Promise.resolve(vscode.workspace.findFiles(`**/${name}`, "**/node_modules/**", 5))
        .then((matches) => {
          if (matches.length === 1) {
            show(matches[0])
            return
          }
          if (matches.length > 1) {
            const items = matches.map((m) => ({ label: vscode.workspace.asRelativePath(m), uri: m }))
            vscode.window.showQuickPick(items, { placeHolder: `Multiple matches for "${name}"` }).then((p) => {
              if (p) show(p.uri)
            })
            return
          }
          vscode.window.showWarningMessage(`File not found: ${filePath}`)
        })
        .catch((err: unknown) => console.error("[Kilo New] findFiles failed:", err))
    },
  )
}
