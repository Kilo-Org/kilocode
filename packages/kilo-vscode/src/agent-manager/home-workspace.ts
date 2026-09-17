import { homedir } from "node:os"
import * as path from "node:path"

/** Whether `dir` is exactly the home directory or a filesystem root. */
export function isRestrictedRoot(dir: string | undefined): boolean {
  if (!dir) return false
  const resolved = path.resolve(dir)
  const root = path.parse(resolved).root
  const same = (a: string, b: string) =>
    process.platform === "darwin" || process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
  return same(resolved, path.resolve(homedir())) || same(resolved, root)
}
