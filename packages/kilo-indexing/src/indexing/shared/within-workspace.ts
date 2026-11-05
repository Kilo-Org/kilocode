import { realpath } from "fs/promises"
import * as path from "path"

/**
 * True when `file` exists and its real path is inside `root`. A committed symlink, on the file or on any parent
 * directory, could otherwise make the scanner read, embed and return a file the workspace does not contain.
 */
export async function withinWorkspace(root: string, file: string, resolvedRoot?: string): Promise<boolean> {
  const base = resolvedRoot ?? (await realpath(root).catch(() => path.resolve(root)))
  const target = await realpath(file).catch(() => undefined)
  if (!target) return false
  const relative = path.relative(base, target)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
