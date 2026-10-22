import * as path from "path"

export function resolveInside(dir: string, file: string): string | undefined {
  if (path.isAbsolute(file)) return undefined
  const full = path.resolve(dir, file)
  const base = path.resolve(dir)
  if (full !== base && !full.startsWith(base + path.sep)) return undefined
  return full
}
