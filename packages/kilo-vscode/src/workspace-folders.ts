/**
 * Folder resolution for multi-root VS Code workspaces.
 *
 * A window can hold several workspace folders. These helpers answer "which
 * folder does this path belong to" without importing vscode, so the rules
 * stay unit-testable.
 */

import * as path from "path"

const fold = (value: string) =>
  process.platform === "win32" || process.platform === "darwin" ? value.toLowerCase() : value

/** True when `target` is `root` itself or lies inside it. */
export function within(root: string, target: string): boolean {
  const rel = path.relative(fold(path.resolve(root)), fold(path.resolve(target)))
  if (rel === "") return true
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

/** The deepest folder containing `target`, so nested folders win over their parents. */
export function folderFor(target: string, roots: readonly string[]): string | undefined {
  return roots.reduce<string | undefined>((best, root) => {
    if (!within(root, target)) return best
    if (best && within(root, best)) return best
    return root
  }, undefined)
}
