import { realpath } from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"
import { contains } from "../path-utils"

/**
 * Stat-check candidate paths and return which ones are actual files (not directories).
 *
 * The webview marks every inline code span as a file-link candidate; this confirms
 * which of those candidates resolve to a real file so the webview can promote them
 * to clickable links and leave the rest as plain code.
 *
 * Containment is enforced twice so auto-validated model output can't probe host
 * files outside the session `root`:
 * 1. a lexical check rejects absolute paths elsewhere, UNC paths, and `../`
 *    traversal before touching the filesystem at all;
 * 2. the candidate's real path (symlinks resolved) must still be inside the
 *    real root, so a checked-in symlink can't escape the root either.
 */
export function validateFiles(root: string, paths: string[]): Promise<string[]> {
  return Promise.resolve(realpath(root)).then(
    (realRoot) => {
      const check = (p: string): Promise<string | null> => {
        if (!contains(root, p)) return Promise.resolve(null)
        return Promise.resolve(realpath(path.resolve(root, p))).then(
          (real) => {
            if (!contains(realRoot, real)) return null
            return Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(real))).then(
              (s) => (s.type & vscode.FileType.File ? p : null),
              () => null,
            )
          },
          () => null,
        )
      }
      return Promise.all(paths.map(check)).then((r) => r.filter((x): x is string => x !== null))
    },
    () => [],
  )
}
