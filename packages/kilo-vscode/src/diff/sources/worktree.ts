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
  /**
   * Resolve the directory to diff. Defaults to the VS Code workspace root.
   * Agent Manager passes a worktree path so the source diffs inside the
   * worktree rather than the main checkout.
   */
  dir?: () => string | undefined
  /**
   * When true, a `dir` that resolves to undefined yields an empty diff rather
   * than falling back to the workspace root. Prevents an unresolvable
   * worktree context from silently diffing the main checkout.
   */
  strictDir?: boolean
  /**
   * Explicit base branch to diff against. When set, the source skips
   * auto-resolution (tracking → default) and diffs against this ref directly.
   * Agent Manager passes the worktree's recorded parent so a worktree always
   * compares against its own base even when the workspace default differs.
   */
  baseBranch?: string
  /** Shared GitOps / log so sources don't each spawn their own channel. */
  git?: GitOps
  log?: (...args: unknown[]) => void
}

/**
 * Diffs between the local working tree and the base branch. Each fetch returns
 * a summary (one entry per changed file, no content); the viewer loads
 * `before`/`after` per file on demand via `fetchFile`. Runs entirely in the
 * extension host — no `kilo serve` round-trip.
 */
export function createWorktreeDiffSource(opts: WorktreeDiffSourceOptions = {}): DiffSource {
  const output = opts.git ? undefined : vscode.window.createOutputChannel("Kilo Diff: Workspace")
  const log = opts.log ?? ((...args: unknown[]) => appendOutput(output!, "WorktreeDiffSource", ...args))
  const git = opts.git ?? new GitOps({ log })

  const root = (): string | undefined => {
    const dir = opts.dir?.()
    if (dir) return dir
    if (opts.strictDir) return undefined
    return getWorkspaceRoot()
  }

  // Cached between fetches so repeated polling doesn't re-resolve the base
  // branch every tick. Reset only on dispose (when the source is swapped out).
  let target: DiffTarget | undefined

  const resolveTarget = async (): Promise<DiffTarget | undefined> => {
    if (target) return target
    if (opts.baseBranch) {
      const dir = root()
      if (!dir) {
        log("Local diff: no directory (explicit base mode)")
        return
      }
      target = { directory: dir, baseBranch: opts.baseBranch }
      log(`Local diff: using explicit base=${opts.baseBranch} dir=${dir}`)
      return target
    }
    if (opts.baseBranchOverride) {
      const dir = root()
      if (!dir) {
        log("Local diff: no workspace root (override mode)")
        return
      }
      const resolved = await resolveOverrideRef(git, dir, opts.baseBranchOverride, log)
      if (!resolved) {
        log(`Local diff: override base="${opts.baseBranchOverride}" could not be resolved, falling back to auto`)
      } else {
        target = { directory: dir, baseBranch: resolved }
        log(`Local diff: using override base=${resolved}`)
        return target
      }
    }
    target = await resolveLocalDiffTarget(git, log, root())
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
      // Only dispose resources we own (created here). Injected git/log are
      // owned by the caller.
      if (!opts.git) git.dispose()
      output?.dispose()
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
 * expected by the diff viewer. Preserve its hunk-bounded `patch` so Pierre can
 * parse the git diff directly rather than recomputing a diff from full source
 * contents; summarized entries still coerce optional content to empty strings.
 */
function toDiffFile(entry: WorktreeDiffEntry): DiffFile {
  return {
    file: entry.file ?? "",
    before: entry.before ?? "",
    after: entry.after ?? "",
    patch: entry.patch,
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.status,
    tracked: entry.tracked,
    generatedLike: entry.generatedLike,
    summarized: entry.summarized,
    stamp: entry.stamp,
    kind: entry.kind,
    image: entry.image,
  }
}
