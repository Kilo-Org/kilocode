import * as vscode from "vscode"
import { GitOps } from "../../agent-manager/GitOps"
import { generatedLike } from "../../agent-manager/local-diff"
import { appendOutput, getWorkspaceRoot } from "../../review-utils"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"
import {
  blobSize,
  INDEX_REF,
  MAX_DETAIL_BYTES,
  parseNameStatus,
  parseNumstat,
  showBlob,
  summarize,
  type FileEntry,
} from "./git-status"

export const STAGED_SOURCE_ID = "staged"

export const STAGED_DESCRIPTOR: DiffSourceDescriptor = {
  id: STAGED_SOURCE_ID,
  type: "staged",
  group: "Git",
  capabilities: { revert: false, comments: true },
}

/**
 * Diff between the git index and HEAD — what `git diff --cached` would show.
 * Polls on the standard interval; revert isn't supported (use `git reset` from
 * a real git client). Read-only view.
 */
export function createStagedDiffSource(): DiffSource {
  const output = vscode.window.createOutputChannel("Kilo Diff: Staged")
  const log = (...args: unknown[]) => appendOutput(output, "StagedDiffSource", ...args)
  const git = new GitOps({ log })

  const root = (): string | undefined => getWorkspaceRoot()

  const listEntries = async (dir: string): Promise<FileEntry[]> => {
    const [nameStatus, numstat] = await Promise.all([
      git.execGit(["-c", "core.quotepath=false", "diff", "--cached", "--name-status", "--no-renames", "HEAD"], dir),
      git.execGit(["-c", "core.quotepath=false", "diff", "--cached", "--numstat", "--no-renames", "HEAD"], dir),
    ])
    if (nameStatus.code !== 0) {
      log("git diff --cached --name-status failed", { code: nameStatus.code, stderr: nameStatus.stderr.trim() })
      return []
    }
    const counts = parseNumstat(numstat.code === 0 ? numstat.stdout : "")
    const items = parseNameStatus(nameStatus.stdout)
    return items.map((item) => ({
      file: item.file,
      status: item.status,
      additions: counts.get(item.file)?.additions ?? 0,
      deletions: counts.get(item.file)?.deletions ?? 0,
      tracked: true,
    }))
  }

  return {
    descriptor: STAGED_DESCRIPTOR,

    async fetch(): Promise<DiffSourceFetch> {
      const dir = root()
      if (!dir) {
        log("No workspace root")
        return { diffs: [] }
      }
      const entries = await listEntries(dir)
      log(`Staged diff: ${entries.length} file(s)`)
      return { diffs: entries.map(summarize) }
    },

    async fetchFile(file: string): Promise<DiffFile | null> {
      const dir = root()
      if (!dir || !file) return null

      // Resolve the entry for this single file so we know its status. Reading
      // both refs blindly would still work, but knowing the status lets us
      // skip impossible reads (e.g. HEAD: for an added file).
      const entry = await fileEntry(git, dir, file, log)
      if (!entry) return null

      const beforeBytes = entry.status === "added" ? 0 : await blobSize(git, dir, "HEAD", file)
      const afterBytes = entry.status === "deleted" ? 0 : await blobSize(git, dir, INDEX_REF, file)
      if (beforeBytes > MAX_DETAIL_BYTES || afterBytes > MAX_DETAIL_BYTES) {
        log("Staged detail skipped: file too large", { file, beforeBytes, afterBytes, cap: MAX_DETAIL_BYTES })
        return summarize(entry)
      }

      // For added: HEAD has no blob. For deleted: index has no blob.
      const before = entry.status === "added" ? "" : await showBlob(git, dir, "HEAD", file)
      const after = entry.status === "deleted" ? "" : await showBlob(git, dir, INDEX_REF, file)
      const summarized = before === "" && after === "" && entry.status === "modified"
      return {
        file,
        before,
        after,
        additions: entry.additions,
        deletions: entry.deletions,
        status: entry.status,
        tracked: true,
        generatedLike: generatedLike(file),
        summarized,
        stamp: `${entry.status}:${entry.additions}:${entry.deletions}`,
      }
    },

    dispose(): void {
      git.dispose()
      output.dispose()
    },
  }
}

async function fileEntry(
  git: GitOps,
  dir: string,
  file: string,
  log: (...args: unknown[]) => void,
): Promise<FileEntry | undefined> {
  const result = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--cached", "--name-status", "--no-renames", "HEAD", "--", file],
    dir,
  )
  if (result.code !== 0) {
    log("Single-file staged status lookup failed", { file, stderr: result.stderr.trim() })
    return undefined
  }
  const items = parseNameStatus(result.stdout)
  const item = items[0]
  if (!item) return undefined

  const counts = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--cached", "--numstat", "--no-renames", "HEAD", "--", file],
    dir,
  )
  const stats = parseNumstat(counts.code === 0 ? counts.stdout : "")
  return {
    file: item.file,
    status: item.status,
    additions: stats.get(item.file)?.additions ?? 0,
    deletions: stats.get(item.file)?.deletions ?? 0,
    tracked: true,
  }
}
