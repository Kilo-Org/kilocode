// Shared parsing helpers for the staged / unstaged diff sources. Both run
// off `git diff` variants and need the same name-status + numstat stitching.

import * as fs from "fs/promises"
import * as path from "path"
import type { GitOps } from "../../agent-manager/GitOps"
import { generatedLike } from "../../agent-manager/local-diff"
import type { DiffFile } from "../types"

export { MAX_DETAIL_BYTES } from "../../agent-manager/local-diff"

export type Status = "added" | "deleted" | "modified"

export interface FileEntry {
  file: string
  status: Status
  additions: number
  deletions: number
  tracked: boolean
  stamp?: string
}

/** Parse `git diff --name-status` output into entries (status code + path). */
export function parseNameStatus(stdout: string): { file: string; status: Status }[] {
  const out: { file: string; status: Status }[] = []
  for (const line of stdout.split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    const code = parts[0]
    const file = parts.slice(1).join("\t")
    if (!code || !file) continue
    out.push({ file, status: statusFromCode(code) })
  }
  return out
}

/** Parse `git diff --numstat` output into a per-file `{additions, deletions}` map. */
export function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const additions = parts[0] === "-" ? 0 : parseInt(parts[0]!, 10) || 0
    const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]!, 10) || 0
    const file = parts.slice(2).join("\t")
    if (file) map.set(file, { additions, deletions })
  }
  return map
}

function statusFromCode(code: string): Status {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("D")) return "deleted"
  return "modified"
}

/**
 * Build the summarized DiffFile shape the viewer expects. `before`/`after`
 * are left empty — the controller fetches detail lazily through `fetchFile`.
 */
export function summarize(entry: FileEntry): DiffFile {
  return {
    file: entry.file,
    before: "",
    after: "",
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: generatedLike(entry.file),
    summarized: true,
    // Synthetic stamp keyed on the stats we actually polled: any change to
    // the file's diff produces new additions/deletions, which invalidates
    // the webview-side cached detail via mergeWorktreeDiffs. Callers can
    // supply a custom stamp (see `FileEntry.stamp`) when additions/deletions
    // aren't a reliable change signal — notably untracked files.
    stamp: entry.stamp ?? `${entry.status}:${entry.additions}:${entry.deletions}`,
  }
}

// Used to tell Git "read the file from the staging area" instead of from a commit.
export const INDEX_REF = ""

/**
 * `git show <ref>:<file>` to dump file contents at a specific revision.
 * Returns `""` on failure (binary, missing, etc.) — the caller decides whether
 * to surface that as `summarized` or just empty.
 */
export async function showBlob(git: GitOps, dir: string, ref: string, file: string): Promise<string> {
  const result = await git.execGit(["show", `${ref}:${file}`], dir)
  return result.code === 0 ? result.stdout : ""
}

/**
 * Read a working-tree file off disk, matching git's blob semantics for
 * symlinks: when the entry is a symlink, return its target string (what git
 * stores as the blob) rather than following it and reading the target file's
 * contents. `""` on missing/unreadable.
 *
 * Following symlinks here would be both incorrect (mismatches the index
 * "before" side from `git show :file`) and unsafe — an untracked symlink
 * pointing at e.g. `~/.aws/credentials` would otherwise be surfaced in the
 * diff viewer despite `resolveInside` (which is purely lexical).
 */
export async function readDisk(dir: string, file: string): Promise<string> {
  const full = resolveInside(dir, file)
  if (!full) return ""
  const lstat = await fs.lstat(full).catch(() => undefined)
  if (!lstat) return ""
  if (lstat.isSymbolicLink()) return fs.readlink(full).catch(() => "")
  if (!lstat.isFile()) return ""
  return fs.readFile(full, "utf-8").catch(() => "")
}

// Used to size-cap detail reads without materializing the blob. Mirrors
// local-diff.ts's `blobSize` helper.
export async function blobSize(git: GitOps, dir: string, ref: string, file: string): Promise<number> {
  const result = await git.execGit(["cat-file", "-s", `${ref}:${file}`], dir)
  if (result.code !== 0) return 0
  return parseInt(result.stdout.trim(), 10) || 0
}

/**
 * Size of the working-tree entry at `file`. Uses `lstat` so symlinks report
 * the link's own size (length of the target string) instead of resolving to
 * whatever the link points at — see `readDisk` for why.
 */
export async function fileSize(dir: string, file: string): Promise<number> {
  const full = resolveInside(dir, file)
  if (!full) return 0
  const stat = await fs.lstat(full).catch(() => undefined)
  return stat?.size ?? 0
}

// Rejects absolute paths and any `..` traversal that would escape `dir`.
// Returns the resolved path when safe, `undefined` otherwise.
export function resolveInside(dir: string, file: string): string | undefined {
  if (path.isAbsolute(file)) return undefined
  const full = path.resolve(dir, file)
  const base = path.resolve(dir)
  if (full !== base && !full.startsWith(base + path.sep)) return undefined
  return full
}
