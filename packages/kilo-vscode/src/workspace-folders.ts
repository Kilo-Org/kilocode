/**
 * Folder resolution for multi-root VS Code workspaces.
 *
 * A window can hold several workspace folders. These helpers answer "which
 * folder does this path belong to" and "which folder should new work target"
 * without importing vscode, so the rules stay unit-testable.
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

/**
 * The folder new work should target.
 *
 * An explicit pick wins, then the folder of the active editor, then the folder
 * of the last editor that had one (the active editor is empty while a webview
 * has focus), then the first folder.
 */
export function activeFolder(input: {
  roots: readonly string[]
  picked?: string
  active?: string
  last?: string
}): string | undefined {
  const pick = input.picked ? folderFor(input.picked, input.roots) : undefined
  if (pick) return pick
  const open = input.active ? folderFor(input.active, input.roots) : undefined
  if (open) return open
  const prior = input.last ? folderFor(input.last, input.roots) : undefined
  if (prior) return prior
  return input.roots.at(0)
}

/** `target` relative to the folder that owns it, with forward slashes; undefined outside every folder. */
export function relativeIn(target: string, roots: readonly string[]): string | undefined {
  const root = folderFor(target, roots)
  if (!root) return undefined
  return path.relative(path.resolve(root), path.resolve(target)).replaceAll("\\", "/")
}
