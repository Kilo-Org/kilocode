/**
 * store.ts — Simple text file read/write with truncation
 * Deps: fs/promises (Node built-in)
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"

export async function read(p: string): Promise<string> {
  try { return await readFile(p, "utf-8") } catch { return "" }
}

export async function write(p: string, content: string): Promise<void> {
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, content, "utf-8")
}

export function truncate(raw: string, maxLines = 200, maxBytes = 25_000): {
  text: string
  cut: boolean
} {
  const t = raw.trim()
  const lines = t.split("\n")
  const overL = lines.length > maxLines
  const overB = t.length > maxBytes
  if (!overL && !overB) return { text: t, cut: false }
  const afterL = overL ? lines.slice(0, maxLines).join("\n") : t
  const final = afterL.length > maxBytes
    ? (() => { const c = afterL.lastIndexOf("\n", maxBytes); return afterL.slice(0, c > 0 ? c : maxBytes) })()
    : afterL
  return { text: final + "\n\n> Truncated. Keep entries short.", cut: true }
}
