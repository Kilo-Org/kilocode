import * as vscode from "vscode"
import { GitOps } from "../../agent-manager/GitOps"
import { diffSummary, diffFile } from "../../agent-manager/local-diff"
import type { WorktreeDiffEntry } from "../../agent-manager/types"
import { WorktreeDiffReverter, type DiffTarget, type StatusResolver } from "../shared/reverter"
import { resolveLocalDiffTarget } from "../shared/target"
import { appendOutput, getWorkspaceRoot } from "../../review-utils"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"

export const WORKSPACE_SOURCE_ID = "workspace"

export const WORKSPACE_DESCRIPTOR: DiffSourceDescriptor = {
  id: WORKSPACE_SOURCE_ID,
  type: "workspace",
  group: "Git",
  capabilities: { revert: true, comments: true },
}

export interface WorktreeDiffSourceOptions {
  /**
   * When set, overrides the auto-resolved base branch. The HEAD side stays
   * the current branch — only the comparison target changes. Reset on dispose.
   */
  baseBranchOverride?: string
}

/**
 * Diffs between the local working tree and the base branch. Each fetch returns
 * a summary (one entry per changed file, no content); the viewer loads
 * `before`/`after` per file on demand via `fetchFile`. Runs entirely in the
 * extension host — no `kilo serve` round-trip.
 */
export function createWorktreeDiffSource(opts: WorktreeDiffSourceOptions = {}): DiffSource {
  const output = vscode.window.createOutputChannel("Kilo Diff: Workspace")
  const log = (...args: unknown[]) => appendOutput(output, "WorktreeDiffSource", ...args)
  const git = new GitOps({ log })

  // Cached between fetches so repeated polling doesn't re-resolve the base
  // branch every tick. Reset only on dispose (when the source is swapped out).
  let target: DiffTarget | undefined

  const resolveTarget = async (): Promise<DiffTarget | undefined> => {
    if (target) return target
    if (opts.baseBranchOverride) {
      const root = getWorkspaceRoot()
      if (!root) {
        log("Local diff: no workspace root (override mode)")
        return
      }
      const resolved = await resolveOverrideRef(git, root, opts.baseBranchOverride, log)
      if (!resolved) {
        log(`Local diff: override base="${opts.baseBranchOverride}" could not be resolved, falling back to auto`)
      } else {
        target = { directory: root, baseBranch: resolved }
        log(`Local diff: using override base=${resolved}`)
        return target
      }
    }
    target = await resolveLocalDiffTarget(git, log, getWorkspaceRoot())
    return target
  }

  const status: StatusResolver = async (current, file) => {
    const entry = await diffFile(git, current.directory, current.baseBranch, file, log)
    return entry?.status
  }

  return {
    descriptor: WORKSPACE_DESCRIPTOR,

    async fetch(): Promise<DiffSourceFetch> {
      const current = await resolveTarget()
      if (!current) return { diffs: [] }

      const entries = await diffSummary(git, current.directory, current.baseBranch, log)
      const diffs = entries.map(toDiffFile)
      log(`Diff: ${diffs.length} file(s)`)
      return { diffs }
    },

    async fetchFile(file: string): Promise<DiffFile | null> {
      if (!file) return null
      const current = await resolveTarget()
      if (!current) return null

      try {
        const entry = await diffFile(git, current.directory, current.baseBranch, file, log)
        if (!entry) return null
        return toDiffFile(entry)
      } catch (err) {
        log("Failed to fetch worktree diff file:", err)
        return null
      }
    },

    async revert(file: string): Promise<{ ok: boolean; message: string }> {
      const current = await resolveTarget()
      if (!current) return { ok: false, message: "Could not resolve diff target" }

      try {
        const diff = new WorktreeDiffReverter(git, status, log)
        return await diff.revertFile(current, file)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log("Failed to revert file:", message)
        return { ok: false, message }
      }
    },

    dispose(): void {
      git.dispose()
      output.dispose()
      target = undefined
    },
  }
}

// Branches surfaced by `parseForEachRefOutput` come as short names (e.g.
// `feature` for `refs/remotes/origin/feature`), which `git merge-base` can't
// resolve when there's no local branch of the same name. Try the short name
// first, then `origin/<name>` before giving up.
async function resolveOverrideRef(
  git: GitOps,
  dir: string,
  name: string,
  log: (...args: unknown[]) => void,
): Promise<string | undefined> {
  const direct = await git.execGit(["rev-parse", "--verify", "--quiet", name], dir)
  if (direct.code === 0) return name
  const remote = `origin/${name}`
  const viaRemote = await git.execGit(["rev-parse", "--verify", "--quiet", remote], dir)
  if (viaRemote.code === 0) {
    log(`override "${name}" not a local ref, resolved to "${remote}"`)
    return remote
  }
  return undefined
}

/**
 * Project a `WorktreeDiffEntry` from `local-diff.ts` onto the `DiffFile` shape
 * expected by the diff viewer. Drops `patch` (the webview rebuilds before/after
 * for itself) and coerces optional `before`/`after` to empty strings when the
 * entry is summarized.
 */
function toDiffFile(entry: WorktreeDiffEntry): DiffFile {
  return {
    file: entry.file,
    before: entry.before ?? "",
    after: entry.after ?? "",
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: entry.generatedLike,
    summarized: entry.summarized,
    stamp: entry.stamp,
  }
}
