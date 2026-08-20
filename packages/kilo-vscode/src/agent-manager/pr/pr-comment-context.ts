/**
 * GitHub truncates `diffHunk` at the commented line, so a review comment about
 * what happens *after* that line has no code to point at. The worktree holds
 * the file, so the lines below the comment are read from disk and attached to
 * the thread.
 */
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { PRComment } from "../types"

/** Lines of trailing context, matching the window the panel renders. */
const AFTER = 3
/** A generated or vendored file is not worth reading for three lines. */
const SIZE = 2_000_000
/** Bound the mtime cache so a long session cannot grow it without limit. */
const CACHE = 200

const cache = new Map<string, { mtime: number; lines: string[] }>()

export function clearContextCache(): void {
  cache.clear()
}

/**
 * The last line of a hunk, without its diff marker. GitHub always ends the
 * hunk at the commented line, so this is the text the comment refers to.
 */
function anchor(hunk: string): string | undefined {
  const lines = hunk.split("\n").filter((line) => line.length > 0 && !line.startsWith("\\"))
  const last = lines.at(-1)
  return lines.length > 1 && last ? last.slice(1) : undefined
}

async function lines(dir: string, file: string): Promise<string[] | undefined> {
  const root = await realpath(dir).catch(() => undefined)
  const full = await realpath(path.resolve(dir, file)).catch(() => undefined)
  if (!root || !full) return undefined
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined
  const info = await stat(full).catch(() => undefined)
  if (!info?.isFile() || info.size > SIZE) return undefined
  const hit = cache.get(full)
  if (hit && hit.mtime === info.mtimeMs) return hit.lines
  const text = await readFile(full, "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const value = text.split("\n")
  if (cache.size >= CACHE) cache.clear()
  cache.set(full, { mtime: info.mtimeMs, lines: value })
  return value
}

/**
 * Attach trailing context to every thread whose file still matches its hunk.
 * The anchor check is what keeps this honest: once the agent edits the file,
 * the commented line no longer matches and the thread keeps hunk-only context
 * instead of showing unrelated code.
 */
export async function withContext(dir: string, comments: PRComment[]): Promise<PRComment[]> {
  return Promise.all(
    comments.map(async (item) => {
      if (!item.file || !item.line || !item.diffHunk || item.outdated) return item
      const text = anchor(item.diffHunk)
      if (text === undefined) return item
      const source = await lines(dir, item.file)
      if (!source || source[item.line - 1] !== text) return item
      const after = source.slice(item.line, item.line + AFTER)
      return after.length > 0 ? { ...item, after } : item
    }),
  )
}
