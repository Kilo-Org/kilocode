import * as vscode from "vscode"
import { contains, isAbsolutePath } from "../path-utils"

/**
 * Stat-check candidate paths and return which ones are actual files (not directories).
 *
 * The webview marks every inline code span as a file-link candidate; this confirms
 * which of those candidates resolve to a real file so the webview can promote them
 * to clickable links and leave the rest as plain code.
 *
 * Candidates that resolve outside the session `root` (absolute paths elsewhere,
 * UNC paths, or `../` traversal) are rejected without touching the filesystem, so
 * auto-validated model output can't probe arbitrary host paths.
 */
export function validateFiles(root: string, paths: string[]): Promise<string[]> {
  const check = (p: string): Promise<string | null> => {
    if (!contains(root, p)) return Promise.resolve(null)
    const uri = isAbsolutePath(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(vscode.Uri.file(root), p)
    return Promise.resolve(vscode.workspace.fs.stat(uri)).then(
      (s) => (s.type & vscode.FileType.File ? p : null),
      () => null,
    )
  }
  return Promise.all(paths.map(check)).then((r) => r.filter((x): x is string => x !== null))
}
