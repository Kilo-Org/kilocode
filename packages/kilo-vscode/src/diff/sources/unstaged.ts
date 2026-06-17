import * as fs from "fs/promises"
import * as vscode from "vscode"
import { GitOps } from "../../agent-manager/GitOps"
import { generatedLike } from "../../agent-manager/local-diff"
import { appendOutput, getWorkspaceRoot } from "../../review-utils"
import { binaryFile } from "../shared/binary"
import { imageMime, loadImage } from "../shared/image"
import { resolveInside } from "../shared/path"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"
import {
  blobOid,
  blobSize,
  diskStamp,
  fileSize,
  INDEX_REF,
  MAX_DETAIL_BYTES,
  parseNameStatus,
  parseNumstat,
  parseRawOids,
  readDisk,
  readDiskBytes,
  showBlob,
  showBlobBytes,
  summarize,
  type FileEntry,
} from "./git-status"

export const UNSTAGED_SOURCE_ID = "unstaged"

export const UNSTAGED_DESCRIPTOR: DiffSourceDescriptor = {
  id: UNSTAGED_SOURCE_ID,
  type: "unstaged",
  group: "Git",
  capabilities: { revert: false, comments: true },
}

function stamp(entry: FileEntry, before: string, after: string): FileEntry {
  if (!imageMime(entry.file)) return entry
  return { ...entry, stamp: `${entry.status}:${before}:${after}` }
}

/**
 * Diff between the working tree and the index — what `git diff` shows for
 * tracked files, plus untracked files (treated as fully-added). Read-only;
 * polls on the standard interval.
 */
export function createUnstagedDiffSource(): DiffSource {
  const output = vscode.window.createOutputChannel("Kilo Diff: Unstaged")
  const log = (...args: unknown[]) => appendOutput(output, "UnstagedDiffSource", ...args)
  const git = new GitOps({ log })

  const root = (): string | undefined => getWorkspaceRoot()

  const listTracked = async (dir: string): Promise<FileEntry[]> => {
    const [nameStatus, numstat, raw] = await Promise.all([
      git.execGit(["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames"], dir),
      git.execGit(["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames"], dir),
      git.execGit(["-c", "core.quotepath=false", "diff", "--raw", "--abbrev=64", "--no-renames"], dir),
    ])
    if (nameStatus.code !== 0) {
      log("git diff --name-status failed", { code: nameStatus.code, stderr: nameStatus.stderr.trim() })
      return []
    }
    const counts = parseNumstat(numstat.code === 0 ? numstat.stdout : "")
    const refs = parseRawOids(raw.code === 0 ? raw.stdout : "")
    return Promise.all(
      parseNameStatus(nameStatus.stdout).map(async (item) => {
        const entry = {
          file: item.file,
          status: item.status,
          additions: counts.get(item.file)?.additions ?? 0,
          deletions: counts.get(item.file)?.deletions ?? 0,
          tracked: true,
          binary: counts.get(item.file)?.binary ?? false,
        }
        if (!imageMime(item.file)) return entry
        const before = item.status === "added" ? "missing" : (refs.get(item.file)?.before ?? "missing")
        const after = item.status === "deleted" ? "missing" : await diskStamp(dir, item.file)
        return stamp(entry, before, after)
      }),
    )
  }

  const listUntracked = async (dir: string): Promise<FileEntry[]> => {
    const result = await git.execGit(["ls-files", "--others", "--exclude-standard"], dir)
    if (result.code !== 0) {
      log("git ls-files --others failed", { code: result.code, stderr: result.stderr.trim() })
      return []
    }
    const out: FileEntry[] = []
    for (const file of result.stdout.split("\n")) {
      if (!file.trim()) continue
      const full = resolveInside(dir, file)
      if (!full) continue
      // `lstat` so an untracked symlink listed by `ls-files --others` is
      // recognized via the link itself rather than its target. `readDisk`
      // returns the target string for symlinks (matching git's blob), so
      // we never read whatever is on the other side.
      const stat = await fs.lstat(full).catch(() => undefined)
      if (!stat) continue
      out.push({
        file,
        status: "added",
        additions: 0,
        deletions: 0,
        tracked: false,
        binary: await binaryFile(full),
        // Untracked entries always have additions/deletions = 0 (numstat
        // can't compute them without an index blob), so fold size+mtime
        // into the stamp. Editing the file changes mtime → the webview
        // cache invalidates and refetches detail. Without this the user
        // sees stale before/after content while polling continues.
        stamp: `added:untracked:${stat.size}:${stat.mtimeMs}`,
      })
    }
    return out
  }

  return {
    descriptor: UNSTAGED_DESCRIPTOR,

    async fetch(): Promise<DiffSourceFetch> {
      const dir = root()
      if (!dir) {
        log("No workspace root")
        return { diffs: [] }
      }
      const [tracked, untracked] = await Promise.all([listTracked(dir), listUntracked(dir)])
      // Drop any tracked entry that's also untracked (shouldn't happen but be
      // defensive — git can race here when files are added concurrently).
      const seen = new Set(tracked.map((t) => t.file))
      const merged = tracked.concat(untracked.filter((u) => !seen.has(u.file)))
      log(`Unstaged diff: ${merged.length} file(s) (${tracked.length} tracked, ${untracked.length} untracked)`)
      return { diffs: merged.map(summarize) }
    },

    async fetchFile(file: string): Promise<DiffFile | null> {
      const dir = root()
      if (!dir || !file || !resolveInside(dir, file)) return null

      const entry = await fileEntry(git, dir, file, log)
      if (!entry) return null
      const mime = imageMime(file)
      if (entry.binary && !mime) return summarize(entry)

      const bytes = await detailBytes(git, dir, file, entry)
      const image = await imageDetail(git, dir, file, entry, bytes.before, bytes.after)
      if (image) return image

      if (bytes.before > MAX_DETAIL_BYTES || bytes.after > MAX_DETAIL_BYTES) {
        log("Unstaged detail skipped: file too large", {
          file,
          beforeBytes: bytes.before,
          afterBytes: bytes.after,
          cap: MAX_DETAIL_BYTES,
        })
        return summarize(entry)
      }

      // Untracked: no index blob, after = disk content.
      // Tracked added/modified/deleted: before = index blob (or "" for added),
      // after = disk content (or "" for deleted).
      const before = !entry.tracked || entry.status === "added" ? "" : await showBlob(git, dir, INDEX_REF, file)
      const after = entry.status === "deleted" ? "" : await readDisk(dir, file)
      const result = entry.tracked
        ? await git.execGit(["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", "--", file], dir)
        : undefined
      const patch = result?.code === 0 ? result.stdout : undefined
      const summarized = before === "" && after === "" && entry.status === "modified"

      // For untracked added files numstat doesn't return counts, so backfill
      // from the disk content's line count.
      const additions = !entry.tracked ? lineCount(after) : entry.additions
      return {
        file,
        before,
        after,
        patch,
        additions,
        deletions: entry.deletions,
        status: entry.status,
        tracked: entry.tracked,
        generatedLike: generatedLike(file),
        summarized,
        // Match the summary stamp so cache invalidation is consistent across
        // summarize → fetchFile transitions. `entry.stamp` is set for
        // untracked entries (size:mtime); tracked entries fall back to the
        // numstat-derived stamp.
        stamp: entry.stamp ?? `${entry.status}:${additions}:${entry.deletions}`,
      }
    },

    dispose(): void {
      git.dispose()
      output.dispose()
    },
  }
}

async function detailBytes(git: GitOps, dir: string, file: string, entry: FileEntry) {
  const before = !entry.tracked || entry.status === "added" ? 0 : await blobSize(git, dir, INDEX_REF, file)
  const after = entry.status === "deleted" ? 0 : await fileSize(dir, file)
  return { before, after }
}

async function imageDetail(
  git: GitOps,
  dir: string,
  file: string,
  entry: FileEntry,
  beforeBytes: number,
  afterBytes: number,
): Promise<DiffFile | undefined> {
  if (!imageMime(file)) return undefined
  const image = await loadImage(
    file,
    !entry.tracked || entry.status === "added"
      ? undefined
      : { bytes: beforeBytes, read: () => showBlobBytes(git, dir, INDEX_REF, file) },
    entry.status === "deleted" ? undefined : { bytes: afterBytes, read: () => readDiskBytes(dir, file) },
  )
  return { ...summarize(entry), summarized: false, image }
}

async function fileEntry(
  git: GitOps,
  dir: string,
  file: string,
  log: (...args: unknown[]) => void,
): Promise<FileEntry | undefined> {
  // Tracked path: `git diff --name-status -- <file>` resolves status without
  // reading content. If the file isn't tracked, fall through to untracked.
  const tracked = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames", "--", file],
    dir,
  )
  if (tracked.code === 0 && tracked.stdout.trim()) {
    const item = parseNameStatus(tracked.stdout)[0]
    if (item) {
      const counts = await git.execGit(
        ["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", "--", file],
        dir,
      )
      const stats = parseNumstat(counts.code === 0 ? counts.stdout : "")
      const entry = {
        file: item.file,
        status: item.status,
        additions: stats.get(item.file)?.additions ?? 0,
        deletions: stats.get(item.file)?.deletions ?? 0,
        tracked: true,
        binary: stats.get(item.file)?.binary ?? false,
      }
      if (!imageMime(item.file)) return entry
      const [before, after] = await Promise.all([
        item.status === "added" ? "missing" : blobOid(git, dir, INDEX_REF, item.file),
        item.status === "deleted" ? "missing" : diskStamp(dir, item.file),
      ])
      return stamp(entry, before, after)
    }
  }

  // Untracked branch: confirm via fs.lstat that the file actually exists.
  // `resolveInside` rejects absolute paths and `..` segments so a crafted
  // webview message can't read outside the workspace; `lstat` (vs `stat`)
  // ensures we don't follow symlinks into arbitrary filesystem locations.
  const full = resolveInside(dir, file)
  if (!full) {
    log("Unstaged file rejected: outside workspace", { file })
    return undefined
  }
  const untracked = await git.execGit(["ls-files", "--others", "--exclude-standard", "--", file], dir)
  if (untracked.code !== 0 || !untracked.stdout.split("\n").includes(file)) return undefined
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) {
    log("Unstaged file not found", { file })
    return undefined
  }
  return {
    file,
    status: "added",
    additions: 0,
    deletions: 0,
    tracked: false,
    binary: await binaryFile(full),
    stamp: `added:untracked:${stat.size}:${stat.mtimeMs}`,
  }
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
}
