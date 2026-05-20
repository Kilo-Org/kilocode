/**
 * entry.ts — Extract config entry name from file path
 * Deps: Node path
 *
 * name("configs/db.local.json", ["configs/"]) → "db.local"
 */
import { basename, extname } from "path"

export function name(filePath: string, roots: string[]): string {
  const norm = filePath.replaceAll("\\", "/")
  for (const r of roots) {
    const i = norm.indexOf(r)
    if (i !== -1) { const c = norm.slice(i + r.length); const e = extname(c); return e.length ? c.slice(0, -e.length) : c }
  }
  const b = basename(filePath)
  const e = extname(b)
  return e.length ? b.slice(0, -e.length) : b
}
