// Shared parsing helpers for the staged / unstaged diff sources. Both run
// off `git diff` variants and need the same name-status + numstat stitching.

import * as fs from "fs/promises"
import type { GitOps } from "../../agent-manager/GitOps"
import { generatedLike } from "../../agent-manager/local-diff"
import { imageMime, readImageFile } from "../shared/image"
import { resolveInside } from "../shared/path"
import type { DiffFile } from "../types"

export { MAX_DETAIL_BYTES } from "../../agent-manager/local-diff"

export type Status = "added" | "deleted" | "modified"

export interface FileEntry {
  file: string
  status: Status
  additions: number
  deletions: number
  tracked: boolean
  binary: boolean
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
export function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const map = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const binary = parts[0] === "-" || parts[1] === "-"
    const additions = binary ? 0 : parseInt(parts[0]!, 10) || 0
    const deletions = binary ? 0 : parseInt(parts[1]!, 10) || 0
    const file = parts.slice(2).join("\t")
    if (file) map.set(file, { additions, deletions, binary })
  }
  return map
}

export function parseRawOids(stdout: string): Map<string, { before: string; after: string }> {
  const map = new Map<string, { before: string; after: string }>()
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t")
    if (!line.startsWith(":") || tab < 0) continue
    const meta = line.slice(1, tab).split(" ")
    const file = line.slice(tab + 1)
    if (!file || !meta[2] || !meta[3]) continue
    map.set(file, { before: meta[2], after: meta[3] })
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
  const image = imageMime(entry.file) !== undefined
  return {
    file: entry.file,
    before: "",
    after: "",
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: generatedLike(entry.file),
    // Binary metadata is complete because no deferred text body exists.
    // Images are the exception: their encoded sides load lazily on expansion.
    summarized: image || !entry.binary,
    // Synthetic stamp keyed on the stats we actually polled: any change to
    // the file's diff produces new additions/deletions, which invalidates
    // the webview-side cached detail via mergeWorktreeDiffs. Callers can
    // supply a custom stamp (see `FileEntry.stamp`) when additions/deletions
    // aren't a reliable change signal — notably untracked files.
    stamp: entry.stamp ?? `${entry.status}:${entry.additions}:${entry.deletions}`,
    kind: image ? "image" : undefined,
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

export async function showBlobBytes(git: GitOps, dir: string, ref: string, file: string): Promise<Buffer | undefined> {
  const result = await git.execGitBuffer(["show", `${ref}:${file}`], dir)
  return result.code === 0 ? result.stdout : undefined
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

export async function readDiskBytes(dir: string, file: string): Promise<Buffer | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat?.isFile()) return undefined
  return readImageFile(full)
}

// Used to size-cap detail reads without materializing the blob. Mirrors
// local-diff.ts's `blobSize` helper.
export async function blobSize(git: GitOps, dir: string, ref: string, file: string): Promise<number> {
  const result = await git.execGit(["cat-file", "-s", `${ref}:${file}`], dir)
  if (result.code !== 0) return 0
  return parseInt(result.stdout.trim(), 10) || 0
}

export async function blobOid(git: GitOps, dir: string, ref: string, file: string): Promise<string> {
  const result = await git.execGit(["rev-parse", "--verify", `${ref}:${file}`], dir)
  return result.code === 0 ? result.stdout.trim() : "missing"
}

export async function diskStamp(dir: string, file: string): Promise<string> {
  const full = resolveInside(dir, file)
  if (!full) return "missing"
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) return "missing"
  return `${stat.size}:${stat.mtimeMs}`
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
