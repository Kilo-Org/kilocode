import { existsSync } from "fs"
import { isTimeout } from "./command-budget"

export interface BranchListItem {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
  isCheckedOut?: boolean
}

interface PRUrlParts {
  owner: string
  repo: string
  number: number
}

export interface PRInfo {
  headRefName: string
  baseRefName?: string
  headRepositoryOwner?: { login: string }
  isCrossRepository: boolean
  title: string
}

interface WorktreeEntry {
  path: string
  branch: string
  bare: boolean
  detached: boolean
}

/**
 * Why a PR lookup failed. `gh_timeout` is never returned by {@link classifyPRError} — a timeout has
 * no stderr to classify, so only the caller knows — but it belongs in the same union so the poller's
 * handling stays exhaustive.
 */
export type PRErrorKind = "not_found" | "gh_missing" | "gh_auth" | "gh_timeout" | "unknown"

export type WorktreeSetupErrorCode =
  | "git_not_found"
  | "not_git_repo"
  | "lfs_missing"
  | "no_commits"
  | "worktree_missing"
  | "worktree_unregistered"
  | "git_timeout"

/**
 * Extra facts a caller knows that the error text alone cannot prove.
 *
 * A failed `spawn` reports `ENOENT` both when the binary is missing and when the working directory
 * is gone, so the message can never distinguish "git is not installed" from "this worktree was
 * deleted". Everything here exists to keep the classifier from guessing.
 */
export type WorktreeErrorContext = {
  /** Directory the failing command ran in. */
  cwd?: string
  /** True only when a `git --version` probe itself failed to spawn. */
  probeFailed?: boolean
  /** Existence check, injectable for tests. */
  exists?: (dir: string) => boolean
  /**
   * The original error, when the caller still has it.
   *
   * A command killed for exceeding its budget carries `killed`/`signal` and a generic
   * "Command failed" message, so the text alone cannot prove a timeout — see {@link isTimeout}.
   */
  err?: unknown
}

export function parsePRUrl(url: string): PRUrlParts | null {
  let normalized = url.trim()
  if (!normalized.startsWith("http")) normalized = `https://${normalized}`
  normalized = normalized.replace(/\/+$/, "")
  const match = normalized.match(/\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

export function localBranchName(info: PRInfo): string {
  if (info.isCrossRepository) {
    const owner = info.headRepositoryOwner?.login?.toLowerCase()
    if (owner) return `${owner}/${info.headRefName}`
  }
  return info.headRefName
}

export function parseForEachRefOutput(raw: string): {
  locals: Set<string>
  remotes: Set<string>
  dates: Map<string, string>
} {
  const locals = new Set<string>()
  const remotes = new Set<string>()
  const dates = new Map<string, string>()

  for (const line of raw.split("\n")) {
    if (!line) continue
    const [ref, date] = line.split("\t")
    if (ref.includes("HEAD")) continue

    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice(11)
      locals.add(name)
      if (date && !dates.has(name)) dates.set(name, date)
    } else if (ref.startsWith("refs/remotes/origin/")) {
      const name = ref.slice(20)
      remotes.add(name)
      if (date && !dates.has(name)) dates.set(name, date)
    }
  }

  return { locals, remotes, dates }
}

export function buildBranchList(
  locals: Set<string>,
  remotes: Set<string>,
  dates: Map<string, string>,
  defaultBranch: string,
): BranchListItem[] {
  const all = new Set([...locals, ...remotes])
  const branches: BranchListItem[] = [...all].map((name) => ({
    name,
    isLocal: locals.has(name),
    isRemote: remotes.has(name),
    isDefault: name === defaultBranch,
    lastCommitDate: dates.get(name),
  }))

  branches.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    if (a.lastCommitDate && b.lastCommitDate) return b.lastCommitDate.localeCompare(a.lastCommitDate)
    return 0
  })

  return branches
}

export function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue
    const lines = block.split("\n")
    const wtPath = lines.find((l) => l.startsWith("worktree "))?.slice(9)
    if (!wtPath) continue

    const branchLine = lines.find((l) => l.startsWith("branch "))
    const bare = lines.some((l) => l === "bare")
    const detached = lines.some((l) => l === "detached")
    const branch = branchLine ? branchLine.slice(7).replace("refs/heads/", "") : detached ? "(detached)" : "unknown"

    entries.push({ path: wtPath, branch, bare, detached })
  }
  return entries
}

export function checkedOutBranchesFromWorktreeList(raw: string): Set<string> {
  const result = new Set<string>()
  for (const entry of parseWorktreeList(raw)) {
    if (!entry.bare && !entry.detached) result.add(entry.branch)
  }
  return result
}

const SAFE_GIT_REF = /^[a-zA-Z0-9._\-/]+$/

export function validateGitRef(value: string, label: string): void {
  if (!value || !SAFE_GIT_REF.test(value) || value.startsWith("-") || value.includes("..")) {
    throw new Error(`Unsafe ${label}: "${value}"`)
  }
}

/**
 * Normalize a filesystem path for cross-platform comparison.
 * Converts backslashes to forward slashes, strips trailing slashes,
 * and lowercases Windows drive-letter paths (case-insensitive filesystem).
 */
export function normalizePath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "")
  if (/^[A-Za-z]:/.test(normalized)) return normalized.toLowerCase()
  return normalized
}

export function classifyPRError(msg: string): PRErrorKind {
  if (msg.includes("command not found") || msg.includes("ENOENT") || msg.includes("is not recognized"))
    return "gh_missing"
  if (msg.includes("not logged") || msg.includes("auth login")) return "gh_auth"
  if (msg.includes("not found") || msg.includes("Could not resolve")) return "not_found"
  return "unknown"
}

/** True when the text is a failed process spawn rather than a filesystem or git-reported error. */
function spawnFailure(msg: string): boolean {
  return /spawn\b/.test(msg) && msg.includes("ENOENT")
}

/**
 * Map a worktree setup/import failure to a user-facing code.
 *
 * `git_not_found` is only ever returned when git itself is provably the problem: a failed
 * `git --version` probe, or a spawn failure in a working directory that still exists. A spawn
 * failure in a directory that is gone is reported as `worktree_missing`, because telling the user
 * to install git when git works is worse than showing the raw message.
 */
export function classifyWorktreeError(msg: string, ctx?: WorktreeErrorContext): WorktreeSetupErrorCode | undefined {
  // Not a text match: `execWithShellEnv` watchdogs surface as `killed`/`SIGTERM` with a generic
  // "Command failed" message, which `isTimeout` recognizes and `msg.includes("timed out")` misses.
  if (isTimeout(ctx?.err ?? msg)) return "git_timeout"
  if (ctx?.probeFailed) return "git_not_found"
  if (msg.includes("not found in PATH")) return "git_not_found"

  const cwd = ctx?.cwd
  const exists = ctx?.exists ?? existsSync
  const cwdGone = cwd !== undefined && !exists(cwd)
  if (cwdGone) return "worktree_missing"

  if (unregisteredWorktree(msg)) return "worktree_unregistered"
  if (msg.includes("not a git repository")) return "not_git_repo"
  if (msg.includes("Git LFS") && msg.includes("not found")) return "lfs_missing"
  if (msg.includes("no commits yet")) return "no_commits"
  if (spawnFailure(msg)) return "git_not_found"
  return undefined
}

/**
 * `fatal: not a git repository: /repo/.git/worktrees/<name>` — the directory is still on disk but
 * git no longer knows about it, which is a broken worktree rather than a non-repo folder.
 */
export function unregisteredWorktree(msg: string): boolean {
  return /not a git repository:.*[/\\]worktrees[/\\]/.test(msg)
}
