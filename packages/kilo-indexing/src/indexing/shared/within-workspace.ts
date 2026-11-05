import { lstat, realpath } from "fs/promises"
import * as path from "path"

/**
 * True unless `file` is a symlink that resolves outside `root`. A committed symlink could otherwise make the
 * scanner read, embed and return a file the workspace does not contain.
 */
export async function withinWorkspace(root: string, file: string, resolvedRoot?: string): Promise<boolean> {
  const info = await lstat(file).catch(() => undefined)
  if (!info) return false
  if (!info.isSymbolicLink()) return true
  return resolvesInside(root, file, resolvedRoot)
}

async function resolvesInside(root: string, file: string, resolvedRoot?: string) {
  const base = resolvedRoot ?? (await realpath(root).catch(() => path.resolve(root)))
  const target = await realpath(file).catch(() => undefined)
  if (!target) return false
  const relative = path.relative(base, target)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
