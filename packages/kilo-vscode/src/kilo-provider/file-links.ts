import * as vscode from "vscode"
import { isAbsolutePath } from "../path-utils"

/**
 * Stat-check candidate paths and return which ones are actual files (not directories).
 *
 * The webview marks every inline code span as a file-link candidate; this confirms
 * which of those candidates resolve to a real file so the webview can promote them
 * to clickable links and leave the rest as plain code.
 */
export function validateFiles(root: string, paths: string[]): Promise<string[]> {
  const resolve = (p: string) =>
    isAbsolutePath(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(vscode.Uri.file(root), p)
  return Promise.all(
    paths.map((p) =>
      Promise.resolve(vscode.workspace.fs.stat(resolve(p))).then(
        (s) => (s.type & vscode.FileType.File ? p : null),
        () => null,
      ),
    ),
  ).then((r) => r.filter((x): x is string => x !== null))
}
