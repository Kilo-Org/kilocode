/**
 * scan.ts — Scan directory for .md files with metadata
 * Deps: fs/promises, path (Node built-ins)
 */

import { readdir, stat } from "fs/promises"
import { basename, join } from "path"
import { parse as fm } from "./frontmatter"

export type Entry = {
  name: string
  path: string
  modified: number
  description: string | null
  kind: string | undefined
}

const CAP = 200

export async function ls(dir: string, exclude?: string): Promise<Entry[]> {
  try {
    const entries = await readdir(dir, { recursive: true })
    const mds = entries.filter(
      (f): f is string => typeof f === "string" && f.endsWith(".md") && (!exclude || basename(f) !== exclude),
    )
    if (mds.length === 0) return []
    const results = await Promise.allSettled(mds.map(async (rel) => {
      const fp = join(dir, rel)
      const s = await stat(fp)
      const raw = await import("fs/promises").then(m => m.readFile(fp, "utf-8").catch(() => ""))
      const { meta } = fm(raw)
      return { name: rel, path: fp, modified: s.mtimeMs, description: meta.description ?? null, kind: meta.type }
    }))
    return results
      .filter((r): r is PromiseFulfilledResult<Entry> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, CAP)
  } catch { return [] }
}

export function manifest(items: Entry[]): string {
  return items.map(e => {
    const tag = e.kind ? `[${e.kind}] ` : ""
    const ts = new Date(e.modified).toISOString()
    return e.description ? `- ${tag}${e.name} (${ts}): ${e.description}` : `- ${tag}${e.name} (${ts})`
  }).join("\n")
}
