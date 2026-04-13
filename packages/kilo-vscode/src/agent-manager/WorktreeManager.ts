/**
 * WorktreeManager - Manages git worktrees for agent sessions.
 *
 * Ported from kilocode/src/core/kilocode/agent-manager/WorktreeManager.ts.
 * Handles creation, discovery, and cleanup of worktrees stored in
 * {projectRoot}/.kilo/worktrees/
 */

import * as path from "path"
import * as fs from "fs"
import { randomUUID } from "crypto"
import simpleGit, { type SimpleGit } from "simple-git"
import { generateBranchName, sanitizeBranchName } from "./branch-name"
import { type GitOps, nonInteractiveEnv } from "./GitOps"
import { execWithShellEnv } from "./shell-env"
import {
  parsePRUrl,
  localBranchName,
  parseForEachRefOutput,
  buildBranchList,
  parseWorktreeList,
  checkedOutBranchesFromWorktreeList,
  classifyPRError,
  validateGitRef,
  normalizePath,
  type PRInfo,
  type BranchListItem,
} from "./git-import"

const TEMP_PREFIX = ".kilo-delete-"
const RM_OPTS: fs.RmOptions = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }

interface WorktreeInfo {
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). */
  remote?: string
  createdAt: number
  sessionId?: string
}

export type StartPointSource = "remote" | "local-tracking" | "local-branch" | "fallback"

interface StartPointResult {
  ref: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  branch: string
  /** Remote name (e.g. "origin") when the start point came from a remote. */
  remote?: string
  source: StartPointSource
  warning?: string
}

type WorktreeProgressStep = "syncing" | "verifying" | "fetching" | "creating"

export interface CreateWorktreeResult {
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). */
  remote?: string
  startPointSource: StartPointSource
  startPointWarning?: string
}

export interface ExternalWorktreeItem {
  path: string
  branch: string
}

/**
 * Backward compat: split a possibly-prefixed branch like "origin/main" into
 * `{ branch: "main", remote: "origin" }`. If no slash is found, returns bare branch.
 */
function stripRemotePrefix(ref: string): { branch: string; remote?: string } {
  const idx = ref.indexOf("/")
  if (idx > 0) return { branch: ref.slice(idx + 1), remote: ref.slice(0, idx) }
  return { branch: ref }
}

import { KILO_DIR, LEGACY_DIR, migrateAgentManagerData } from "./constants"

const SESSION_ID_FILE = "session-id"
const METADATA_FILE = "metadata.json"

export class WorktreeManager {
  private readonly root: string
  private readonly dir: string
  private readonly git: SimpleGit
  private readonly ops: GitOps | undefined
  private readonly log: (msg: string) => void
  private migrated = false

  constructor(root: string, log: (msg: string) => void, ops?: GitOps) {
    this.root = root
    this.dir = path.join(root, KILO_DIR, "worktrees")
    this.git = simpleGit(root)
    this.ops = ops
    this.log = log
  }

  /** Run once before first read/write to migrate Agent Manager data from .kilocode → .kilo. */
  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    await migrateAgentManagerData(this.root, this.log)
  }

  // ---------------------------------------------------------------------------
  // Per-project git operation mutex
  // ---------------------------------------------------------------------------

  // Serializes git-writing operations per repository root so concurrent
  // callers (e.g. multi-version worktree creation) don't hit index.lock
  // conflicts. Operations on different repositories proceed in parallel.
  private static locks = new Map<string, Promise<void>>()

  // Cache for fetched refs: avoids redundant git fetch calls when creating
  // multiple worktrees from the same base branch (e.g., multi-version mode).
  // Key: `${root}:${remote}:${branch}`, Value: timestamp when fetch was done
  private static fetchCache = new Map<string, number>()
  private static readonly FETCH_CACHE_TTL = 60_000 // 1 minute

  private withGitLock<T>(fn: () => Promise<T>): Promise<T> {
    const key = this.root
    const prev = WorktreeManager.locks.get(key) ?? Promise.resolve()
    const result = prev.then(fn)
    const barrier = result.then(
      () => {},
      () => {},
    )
    WorktreeManager.locks.set(key, barrier)
    return result
  }

  // ---------------------------------------------------------------------------
  // Public API (acquires git lock)
  // ---------------------------------------------------------------------------

  async createWorktree(params: {
    prompt?: string
    existingBranch?: string
    baseBranch?: string
    branchName?: string
    onProgress?: (step: WorktreeProgressStep, message: string, detail?: string) => void
  }): Promise<CreateWorktreeResult> {
    await this.ensureMigrated()
    return this.withGitLock(() => this.createWorktreeImpl(params))
  }

  private async ensureGitAvailable(): Promise<void> {
    try {
      await execWithShellEnv("git", ["--version"])
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "Git is not installed or not found in PATH. Please install Git (https://git-scm.com) and restart VS Code.",
        )
      }
      throw error
    }
  }

  private async createWorktreeImpl(params: {
    prompt?: string
    existingBranch?: string
    baseBranch?: string
    branchName?: string
    onProgress?: (step: WorktreeProgressStep, message: string, detail?: string) => void
  }): Promise<CreateWorktreeResult> {
    await this.ensureGitAvailable()
    const repo = await this.git.checkIsRepo()
    if (!repo)
      throw new Error(
        "This folder is not a git repository. Initialize a repository or open a git project to use worktrees.",
      )

    // Git LFS Pre-flight Check
    if (await this.repoUsesLfs()) {
      if (!(await this.checkLfsAvailable())) {
        throw new Error(
          "This repository uses Git LFS, but git-lfs was not found. Please install Git LFS to use this repository.",
        )
      }
    }

    await this.ensureDir()
    await this.ensureGitExclude()

    // Resolve start point (parent branch + remote)
    let parent: string
    let parentRemote: string | undefined
    let startPoint: StartPointResult | undefined

    if (params.existingBranch) {
      // Existing branch provided directly — only attach remote when the
      // remote tracking ref actually exists (the branch may be local-only).
      const remote = await this.resolveRemote()
      const hasRemoteRef = remote && (await this.refExistsLocally(`${remote}/${params.existingBranch}`))
      parent = params.existingBranch
      parentRemote = hasRemoteRef ? remote : undefined
      startPoint = {
        ref: params.existingBranch,
        branch: params.existingBranch,
        remote: hasRemoteRef ? remote : undefined,
        source: "local-branch",
      }
    } else {
      // Resolve best start point for new branch
      const requestedBase = params.baseBranch || (await this.defaultBranch())
      params.onProgress?.("verifying", `Resolving start point: ${requestedBase}`)

      startPoint = await this.resolveStartPoint(requestedBase, params.onProgress, {
        allowFallback: !params.baseBranch, // Only fallback if user didn't explicitly request a specific base
      })
      parent = startPoint.branch
      parentRemote = startPoint.remote
    }

    const sanitized = params.branchName ? sanitizeBranchName(params.branchName) : undefined
    let branch: string
    if (params.existingBranch) {
      branch = params.existingBranch
    } else if (sanitized) {
      branch = sanitized
    } else {
      const existing = await this.git
        .branch()
        .then((b) => b.all)
        .catch(() => [] as string[])
      branch = generateBranchName(params.prompt || "agent-task", existing)
    }

    if (params.existingBranch) {
      const exists = await this.branchExists(branch)
      if (!exists) throw new Error(`Branch "${branch}" does not exist`)
    }

    const dirName = branch.replace(/\//g, "-")
    let worktreePath = path.join(this.dir, dirName)

    if (fs.existsSync(worktreePath)) {
      this.log(`Worktree directory exists, cleaning up before re-creation: ${worktreePath}`)
      await this.removeWorktreeImpl(worktreePath)
    }

    params.onProgress?.("creating", `Creating worktree for ${branch}...`)

    // Dereference to commit SHA to prevent upstream tracking for new branches
    const startRef = params.existingBranch ? undefined : `${startPoint.ref}^{commit}`

    try {
      const args = params.existingBranch
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath, startRef!]
      await this.runWorktreeAdd(args, worktreePath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes("already checked out")) {
        // Extract worktree path from error like "fatal: 'branch' is already checked out at '/path'"
        const match = msg.match(/already checked out at '([^']+)'/)
        const loc = match ? match[1] : "another worktree"
        throw new Error(`Branch "${branch}" is already checked out in worktree at: ${loc}`)
      }
      if (!msg.includes("already exists") || params.existingBranch) {
        throw new Error(`Failed to create worktree: ${msg}`)
      }
      // Branch name collision -- retry with unique suffix
      branch = `${branch}-${Date.now()}`
      const retryDir = branch.replace(/\//g, "-")
      worktreePath = path.join(this.dir, retryDir)
      const retryArgs = params.existingBranch
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath, startRef!]
      await this.runWorktreeAdd(retryArgs, worktreePath)
    }

    this.log(
      `Created worktree: ${worktreePath} (branch: ${branch}, base: ${parentRemote ? `${parentRemote}/` : ""}${parent})`,
    )
    return {
      branch,
      path: worktreePath,
      parentBranch: parent,
      remote: parentRemote,
      startPointSource: startPoint.source,
      startPointWarning: startPoint.warning,
    }
  }

  /**
   * Run `git worktree add` with post-checkout hook tolerance.
   *
   * Hooks like husky or lefthook run after `git worktree add` and can cause
   * a non-zero exit code even though the worktree was created successfully.
   * When a hook failure is detected, we verify the worktree was registered
   * via `git worktree list --porcelain` before treating it as a real error.
   */
  private async runWorktreeAdd(args: string[], wtPath: string): Promise<void> {
    try {
      await this.git.raw(args)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (this.isHookError(msg) && (await this.worktreeRegistered(wtPath))) {
        this.log(`Ignoring post-checkout hook failure for ${wtPath}: ${msg}`)
        return
      }
      throw error
    }
  }

  /**
   * Detect post-checkout hook failures in git error output.
   * Hooks like husky or lefthook run after `git worktree add` and can fail
   * with a non-zero exit code even though the worktree was created.
   */
  private isHookError(msg: string): boolean {
    const lower = msg.toLowerCase()
    return (
      (lower.includes("hook") || lower.includes("husky") || lower.includes("lefthook")) &&
      (lower.includes("post-checkout") || lower.includes("post_checkout"))
    )
  }

  /**
   * Verify that git actually registered a worktree at the given path by
   * checking `git worktree list --porcelain`. Used to confirm that a
   * worktree was created despite a non-zero exit code (e.g., hook failure).
   */
  private async worktreeRegistered(wtPath: string): Promise<boolean> {
    try {
      const raw = await this.git.raw(["worktree", "list", "--porcelain"])
      const normalized = normalizePath(wtPath)
      return parseWorktreeList(raw).some((e) => normalizePath(e.path) === normalized)
    } catch {
      return false
    }
  }

  /**
   * Remove a worktree directory and its git bookkeeping.
   *
   * Uses a rename-prune-background-rm strategy for speed:
   * 1. Atomically rename the directory so git and pollers stop seeing it instantly
   * 2. Run `git worktree prune` to clean up .git/worktrees/ metadata
   * 3. Delete the renamed directory in the background (non-blocking)
   *
   * When `branch` is provided the local branch is also deleted after pruning.
   */
  async removeWorktree(worktreePath: string, branch?: string): Promise<void> {
    return this.withGitLock(() => this.removeWorktreeImpl(worktreePath, branch))
  }

  private async removeWorktreeImpl(worktreePath: string, branch?: string): Promise<void> {
    if (!fs.existsSync(worktreePath)) {
      // Directory already gone — just prune stale metadata
      await this.git.raw(["worktree", "prune", "--expire", "now"]).catch(() => {})
      this.log(`Worktree directory already absent, pruned metadata: ${worktreePath}`)
      if (branch) await this.deleteBranch(branch)
      return
    }

    if (!this.isManagedPath(worktreePath)) {
      this.log(`Refusing to remove path outside worktrees directory: ${worktreePath}`)
      return
    }

    // 1. Atomic rename — makes the worktree instantly invisible to git and pollers.
    //    rename() is near-instant on the same filesystem (same parent dir guarantees this).
    const temp = path.join(path.dirname(worktreePath), `.kilo-delete-${randomUUID()}`)
    try {
      await fs.promises.rename(worktreePath, temp)
    } catch {
      // Rename failed (e.g. locked files on Windows) — fall back to force remove
      this.log(`Rename failed, falling back to force remove: ${worktreePath}`)
      await this.git.raw(["worktree", "remove", "--force", worktreePath]).catch(() => {})
      if (branch) await this.deleteBranch(branch)
      return
    }

    // 2. Prune git metadata now that the directory is gone from the expected path
    await this.git.raw(["worktree", "prune", "--expire", "now"]).catch(() => {})
    this.log(`Removed worktree (rename+prune): ${worktreePath}`)

    // 3. Delete the local branch while we still hold the git lock
    if (branch) await this.deleteBranch(branch)

    // 4. Background delete — fire-and-forget, cross-platform
    fs.promises.rm(temp, RM_OPTS).catch((err) => {
      this.log(`Background cleanup failed for ${temp}: ${err}`)
    })
  }

  private async deleteBranch(branch: string): Promise<void> {
    try {
      await this.git.raw(["branch", "-D", branch])
      this.log(`Deleted branch: ${branch}`)
    } catch {
      this.log(`Failed to delete branch (may still be referenced): ${branch}`)
    }
  }

  /** Remove orphaned .kilo-delete-* temp dirs left by interrupted deletions. */
  cleanupOrphanedTempDirs(): void {
    if (!fs.existsSync(this.dir)) return
    fs.promises
      .readdir(this.dir, { withFileTypes: true })
      .then((entries) => {
        for (const e of entries) {
          if (e.isDirectory() && e.name.startsWith(TEMP_PREFIX)) {
            const stale = path.join(this.dir, e.name)
            fs.promises.rm(stale, RM_OPTS).catch((err) => {
              this.log(`Failed to clean orphaned temp dir ${stale}: ${err}`)
            })
          }
        }
      })
      .catch(() => {})
  }

  async discoverWorktrees(): Promise<WorktreeInfo[]> {
    await this.ensureMigrated()
    if (!fs.existsSync(this.dir)) return []

    const entries = await fs.promises.readdir(this.dir, { withFileTypes: true })
    this.cleanupOrphanedTempDirs()
    const results = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(TEMP_PREFIX))
        .map((e) => this.worktreeInfo(path.join(this.dir, e.name))),
    )
    return results.filter((info): info is WorktreeInfo => info !== undefined)
  }

  async writeMetadata(worktreePath: string, sessionId: string, parentBranch: string, remote?: string): Promise<void> {
    const dir = path.join(worktreePath, KILO_DIR)
    if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true })

    const meta: Record<string, string> = { sessionId, parentBranch }
    if (remote) meta.remote = remote

    // Write both formats: session-id for backward compat, metadata.json for parentBranch+remote
    await Promise.all([
      fs.promises.writeFile(path.join(dir, SESSION_ID_FILE), sessionId, "utf-8"),
      fs.promises.writeFile(path.join(dir, METADATA_FILE), JSON.stringify(meta), "utf-8"),
    ])
    this.log(`Wrote metadata for session ${sessionId} to ${worktreePath}`)
    await this.ensureWorktreeExclude(worktreePath)
  }

  async readMetadata(
    worktreePath: string,
  ): Promise<{ sessionId: string; parentBranch?: string; remote?: string } | undefined> {
    // Check .kilo/ first, then legacy .kilocode/
    for (const dirName of [KILO_DIR, LEGACY_DIR]) {
      const result = await this.readMetadataFrom(worktreePath, dirName)
      if (result) return result
    }
    return undefined
  }

  private async readMetadataFrom(
    worktreePath: string,
    dirName: string,
  ): Promise<{ sessionId: string; parentBranch?: string; remote?: string } | undefined> {
    const dir = path.join(worktreePath, dirName)

    // Try metadata.json first (has parentBranch + remote)
    try {
      const content = await fs.promises.readFile(path.join(dir, METADATA_FILE), "utf-8")
      const data = JSON.parse(content) as { sessionId?: string; parentBranch?: string; remote?: string }
      if (data.sessionId) {
        return {
          sessionId: data.sessionId,
          parentBranch: data.parentBranch,
          remote: data.remote,
        }
      }
    } catch (e) {
      this.log(`readMetadata: metadata.json unreadable in ${worktreePath}: ${e}`)
    }

    // Legacy: plain text session-id file
    try {
      const content = await fs.promises.readFile(path.join(dir, SESSION_ID_FILE), "utf-8")
      const id = content.trim()
      if (id) return { sessionId: id }
    } catch (e) {
      this.log(`readMetadata: session-id unreadable in ${worktreePath}: ${e}`)
    }

    return undefined
  }

  // ---------------------------------------------------------------------------
  // Git exclude management
  // ---------------------------------------------------------------------------

  async ensureGitExclude(): Promise<void> {
    const gitDir = await this.resolveGitDir()
    const excludePath = path.join(gitDir, "info", "exclude")
    const items = [
      [".kilo/worktrees/", "Kilo Code agent worktrees"],
      [".kilo/agent-manager.json", "Kilo Agent Manager state"],
      [".kilo/setup-script", "Kilo Code worktree setup script"],
      [".kilo/setup-script.sh", "Kilo Code worktree setup script"],
      [".kilo/setup-script.ps1", "Kilo Code worktree setup script"],
      [".kilo/setup-script.cmd", "Kilo Code worktree setup script"],
      [".kilo/setup-script.bat", "Kilo Code worktree setup script"],
      [".kilocode/worktrees/", "Kilo Code legacy agent worktrees"],
      [".kilocode/agent-manager.json", "Kilo Agent Manager legacy state"],
      [".kilocode/setup-script", "Kilo Code legacy worktree setup script"],
      [".kilocode/setup-script.sh", "Kilo Code legacy worktree setup script"],
      [".kilocode/setup-script.ps1", "Kilo Code legacy worktree setup script"],
      [".kilocode/setup-script.cmd", "Kilo Code legacy worktree setup script"],
      [".kilocode/setup-script.bat", "Kilo Code legacy worktree setup script"],
    ] as const

    for (const [entry, comment] of items) {
      await this.addExcludeEntry(excludePath, entry, comment)
    }
  }

  private async ensureWorktreeExclude(worktreePath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(path.join(worktreePath, ".git"), "utf-8")
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (!match) return

      const worktreeGitDir = path.resolve(worktreePath, match[1].trim())
      const mainGitDir = path.dirname(path.dirname(worktreeGitDir))
      await this.addExcludeEntry(path.join(mainGitDir, "info", "exclude"), `${KILO_DIR}/`, "Kilo Code session metadata")
    } catch (error) {
      this.log(`Warning: Failed to update git exclude for worktree: ${error}`)
    }
  }

  /**
   * Returns true when target is strictly inside the managed worktrees directory.
   * Prevents sibling-prefix confusion such as "/worktrees-evil".
   */
  private isManagedPath(target: string): boolean {
    const root = path.resolve(this.dir)
    const child = path.resolve(target)
    const rel = normalizePath(path.relative(root, child))
    if (!rel || rel === ".") return false
    if (rel.startsWith("../")) return false
    if (path.isAbsolute(rel)) return false
    return true
  }

  private async addExcludeEntry(excludePath: string, entry: string, comment: string): Promise<void> {
    const infoDir = path.dirname(excludePath)
    if (!fs.existsSync(infoDir)) await fs.promises.mkdir(infoDir, { recursive: true })

    let content = ""
    if (fs.existsSync(excludePath)) {
      content = await fs.promises.readFile(excludePath, "utf-8")
      if (content.includes(entry)) return
    }

    const pad = content.endsWith("\n") || content === "" ? "" : "\n"
    await fs.promises.appendFile(excludePath, `${pad}\n# ${comment}\n${entry}\n`)
    this.log(`Added ${entry} to ${excludePath}`)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureDir(): Promise<void> {
    if (!fs.existsSync(this.dir)) {
      await fs.promises.mkdir(this.dir, { recursive: true })
    }
  }

  private async resolveGitDir(): Promise<string> {
    const gitPath = path.join(this.root, ".git")
    const stat = await fs.promises.stat(gitPath)
    if (stat.isDirectory()) return gitPath

    const content = await fs.promises.readFile(gitPath, "utf-8")
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (!match) throw new Error("Invalid .git file format")
    return path.resolve(path.dirname(gitPath), match[1].trim(), "..", "..")
  }

  private async worktreeInfo(wtPath: string): Promise<WorktreeInfo | undefined> {
    const gitFile = path.join(wtPath, ".git")
    if (!fs.existsSync(gitFile)) return undefined

    try {
      const stat = await fs.promises.stat(gitFile)
      if (!stat.isFile()) return undefined
    } catch {
      // .git path inaccessible — not a valid worktree
      return undefined
    }

    try {
      const git = simpleGit(wtPath)
      const [branch, stat, meta] = await Promise.all([
        git.revparse(["--abbrev-ref", "HEAD"]),
        fs.promises.stat(wtPath),
        this.readMetadata(wtPath),
      ])
      // Use persisted metadata if available, fall back to resolveBaseBranch.
      // Backward compat: old metadata may store "origin/main" in parentBranch without
      // a separate remote field. Try to detect this by checking if the prefix is a known remote.
      const base =
        (await (async () => {
          if (!meta?.parentBranch) return undefined
          if (meta.remote) return { branch: meta.parentBranch, remote: meta.remote }
          // Backward compat: old metadata stored "origin/main" in parentBranch.
          // Only split when the prefix is a known remote name (not a branch like "release/1.0").
          const split = stripRemotePrefix(meta.parentBranch)
          if (split.remote) {
            const remotes = await this.git.getRemotes().catch(() => [])
            if (remotes.some((r) => r.name === split.remote)) return split
          }
          return { branch: meta.parentBranch }
        })()) ?? (await this.resolveBaseBranch())
      return {
        branch: branch.trim(),
        path: wtPath,
        parentBranch: base.branch,
        remote: base.remote,
        createdAt: stat.birthtimeMs,
        sessionId: meta?.sessionId,
      }
    } catch (error) {
      this.log(`Failed to get info for worktree ${wtPath}: ${error}`)
      return undefined
    }
  }

  async resolveStartPoint(
    branch: string,
    onProgress?: (step: WorktreeProgressStep, message: string, detail?: string) => void,
    opts?: { allowFallback?: boolean },
  ): Promise<StartPointResult> {
    const { allowFallback = true } = opts || {}

    // 1. Remote fetch (with caching to avoid redundant fetches in multi-version mode)
    const remote = await this.resolveRemote()
    if (remote) {
      const cacheKey = `${this.root}:${remote}:${branch}`
      const cached = WorktreeManager.fetchCache.get(cacheKey)

      // Skip fetch if recently fetched (within TTL) AND ref exists locally
      if (cached && Date.now() - cached < WorktreeManager.FETCH_CACHE_TTL) {
        if (await this.refExistsLocally(`${remote}/${branch}`)) {
          return {
            ref: `${remote}/${branch}`,
            branch,
            remote,
            source: "remote",
          }
        }
      }

      // Either not cached or cache is stale - do the fetch.
      // Use non-interactive env to prevent SSH passphrase popups.
      onProgress?.("fetching", `Fetching ${remote}/${branch}...`)
      try {
        await simpleGit(this.root).env(nonInteractiveEnv()).fetch(remote, branch)
        WorktreeManager.fetchCache.set(cacheKey, Date.now())
        if (await this.refExistsLocally(`${remote}/${branch}`)) {
          return {
            ref: `${remote}/${branch}`,
            branch,
            remote,
            source: "remote",
          }
        }
      } catch (e) {
        this.log(`Failed to fetch ${remote}/${branch}: ${e}`)
      }
    }

    // 2. Stale local tracking ref (offline fallback)
    if (remote && (await this.refExistsLocally(`${remote}/${branch}`))) {
      return {
        ref: `${remote}/${branch}`,
        branch,
        remote,
        source: "local-tracking",
        warning: "Used stale remote tracking branch (fetch failed)",
      }
    }

    // 3. Local branch
    if (await this.refExistsLocally(branch)) {
      return {
        ref: branch,
        branch,
        source: "local-branch",
      }
    }

    // 4. Derived fallback
    if (allowFallback) {
      const fallbacks = await this.derivedFallbackBranches(branch)
      for (const fallback of fallbacks) {
        if (fallback === branch) continue // already tried
        try {
          const res = await this.resolveStartPoint(fallback, onProgress, { allowFallback: false })
          return {
            ...res,
            source: "fallback",
            warning: `Branch "${branch}" not found, falling back to "${fallback}"`,
          }
        } catch (e) {
          this.log(`resolveStartPoint: fallback "${fallback}" failed: ${e}`)
        }
      }
    }

    throw new Error(`Could not resolve start point for branch "${branch}"`)
  }

  /**
   * Resolve the primary remote name for this repo.
   * Uses `GitOps.resolveRemote` when available, otherwise checks for "origin".
   * Returns `undefined` when no remote exists (local-only repo).
   */
  async resolveRemote(): Promise<string | undefined> {
    if (this.ops) {
      const name = await this.ops.resolveRemote(this.root).catch(() => "origin")
      const remotes = await this.git.getRemotes().catch(() => [])
      return remotes.some((r: { name: string }) => r.name === name) ? name : undefined
    }
    const remotes = await this.git.getRemotes().catch(() => [])
    return remotes.some((r) => r.name === "origin") ? "origin" : undefined
  }

  async hasOriginRemote(): Promise<boolean> {
    return (await this.resolveRemote()) !== undefined
  }

  async refExistsLocally(ref: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `${ref}^{commit}`])
      return true
    } catch {
      // ref does not exist
      return false
    }
  }

  async derivedFallbackBranches(requested: string): Promise<string[]> {
    const defaults = []
    try {
      defaults.push(await this.defaultBranch())
    } catch (e) {
      this.log(`derivedFallbackBranches: failed to determine default branch: ${e}`)
    }
    return defaults
  }

  async repoUsesLfs(): Promise<boolean> {
    // Check .git/lfs/ directory
    const gitDir = await this.resolveGitDir()
    if (fs.existsSync(path.join(gitDir, "lfs"))) return true

    // Check .gitattributes
    try {
      const attributes = await fs.promises.readFile(path.join(this.root, ".gitattributes"), "utf-8")
      if (attributes.includes("filter=lfs")) return true
    } catch (e) {
      this.log(`repoUsesLfs: failed to read .gitattributes: ${e}`)
    }

    // Check .git/info/attributes
    try {
      const infoAttributes = await fs.promises.readFile(path.join(gitDir, "info", "attributes"), "utf-8")
      if (infoAttributes.includes("filter=lfs")) return true
    } catch (e) {
      this.log(`repoUsesLfs: failed to read info/attributes: ${e}`)
    }

    return false
  }

  async checkLfsAvailable(): Promise<boolean> {
    try {
      await execWithShellEnv("git", ["lfs", "version"], { cwd: this.root, timeout: 5000 })
      return true
    } catch {
      // git-lfs not installed
      return false
    }
  }

  async currentBranch(): Promise<string> {
    if (this.ops) {
      const branch = await this.ops.currentBranch(this.root)
      if (!branch) throw new Error("Failed to determine current branch")
      return branch
    }
    return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim()
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      const branches = await this.git.branch()
      return branches.all.includes(name) || branches.all.includes(`remotes/origin/${name}`)
    } catch (e) {
      this.log(`branchExists: failed to list branches: ${e}`)
      return false
    }
  }

  /**
   * Resolve the base branch and remote for diffs and comparisons.
   * Returns a bare branch name + remote name so callers can construct
   * `${remote}/${branch}` at diff time (mirroring what a PR would show).
   */
  async resolveBaseBranch(): Promise<{ branch: string; remote?: string }> {
    const branch = await this.defaultBranch()
    const remote = await this.resolveRemote()
    if (remote && (await this.refExistsLocally(`${remote}/${branch}`))) {
      return { branch, remote }
    }
    return { branch }
  }

  async defaultBranch(): Promise<string> {
    // 1. Try symbolic-ref against the resolved remote (not hardcoded "origin")
    const remote = await this.resolveRemote()
    if (remote) {
      try {
        const head = await this.git.raw(["symbolic-ref", `refs/remotes/${remote}/HEAD`])
        const prefix = `refs/remotes/${remote}/`
        const trimmed = head.trim()
        if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
      } catch (e) {
        this.log(`defaultBranch: symbolic-ref for ${remote} failed: ${e}`)
      }
    }

    // 2. Try current branch (if not detached)
    try {
      const current = await this.currentBranch()
      if (current && current !== "HEAD") return current
    } catch (e) {
      this.log(`defaultBranch: currentBranch failed: ${e}`)
    }

    // 3. Try first local branch
    try {
      const branches = await this.git.branchLocal()
      if (branches.all.length > 0) return branches.all[0]
    } catch (e) {
      this.log(`defaultBranch: branchLocal failed: ${e}`)
    }

    // Check if this is an empty repo with no commits (unborn branch).
    // rev-parse --verify HEAD exits non-zero only when HEAD has no target
    // commit, which is the definitive test for an unborn branch.
    try {
      await this.git.raw(["rev-parse", "--verify", "HEAD"])
    } catch {
      throw new Error("This repository has no commits yet. Create an initial commit before using worktrees.")
    }

    throw new Error("Could not determine default branch")
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  async listBranches(): Promise<{ branches: BranchListItem[]; defaultBranch: string }> {
    const defBranch = await this.defaultBranch()
    const raw = await this.git.raw([
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)\t%(committerdate:iso-strict)",
      "refs/heads/",
      "refs/remotes/origin/",
    ])
    const { locals, remotes, dates } = parseForEachRefOutput(raw)
    return { branches: buildBranchList(locals, remotes, dates, defBranch), defaultBranch: defBranch }
  }

  async checkedOutBranches(): Promise<Set<string>> {
    try {
      const raw = await this.git.raw(["worktree", "list", "--porcelain"])
      return checkedOutBranchesFromWorktreeList(raw)
    } catch (error) {
      this.log(`Failed to list worktree branches: ${error}`)
      const result = new Set<string>()
      try {
        result.add(await this.currentBranch())
      } catch (inner) {
        this.log(`Failed to get current branch: ${inner}`)
      }
      return result
    }
  }

  async listExternalWorktrees(managedPaths: Set<string>): Promise<ExternalWorktreeItem[]> {
    try {
      const raw = await this.git.raw(["worktree", "list", "--porcelain"])
      const normalizedRoot = normalizePath(this.root)
      const normalizedManaged = new Set([...managedPaths].map(normalizePath))
      return parseWorktreeList(raw)
        .filter(
          (e) => !e.bare && normalizePath(e.path) !== normalizedRoot && !normalizedManaged.has(normalizePath(e.path)),
        )
        .map((e) => ({ path: e.path, branch: e.branch }))
    } catch (error) {
      this.log(`Failed to list external worktrees: ${error}`)
      return []
    }
  }

  async createFromPR(url: string): Promise<CreateWorktreeResult> {
    return this.withGitLock(() => this.createFromPRImpl(url))
  }

  private async createFromPRImpl(url: string): Promise<CreateWorktreeResult> {
    await this.ensureGitAvailable()
    const parsed = parsePRUrl(url)
    if (!parsed) throw new Error("Invalid PR URL. Expected: https://github.com/owner/repo/pull/123")

    const info = await this.fetchPRInfo(parsed)
    const branch = localBranchName(info)
    const isFork = info.isCrossRepository
    const forkOwner = info.headRepositoryOwner?.login?.toLowerCase()

    const checkedOut = await this.checkedOutBranches()
    if (checkedOut.has(branch) || checkedOut.has(info.headRefName)) {
      throw new Error("This PR's branch is already checked out in another worktree")
    }

    await this.fetchPRBranch(info, parsed, isFork, forkOwner)

    if (isFork && forkOwner) {
      if (await this.branchExists(branch)) {
        await this.git.raw(["branch", "-D", branch])
      }
      await this.git.raw(["branch", branch, `${forkOwner}/${info.headRefName}`])
    }

    return this.createWorktreeImpl({ existingBranch: branch })
  }

  private async fetchPRInfo(parsed: { owner: string; repo: string; number: number }): Promise<PRInfo> {
    try {
      const json = await this.exec(
        "gh",
        [
          "pr",
          "view",
          String(parsed.number),
          "--repo",
          `${parsed.owner}/${parsed.repo}`,
          "--json",
          "headRefName,headRepositoryOwner,isCrossRepository,title",
        ],
        30000,
      )
      return JSON.parse(json) as PRInfo
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const kind = classifyPRError(msg)
      if (kind === "not_found") throw new Error(`PR #${parsed.number} not found in ${parsed.owner}/${parsed.repo}`)
      if (kind === "gh_missing")
        throw new Error("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/")
      if (kind === "gh_auth") throw new Error("Not authenticated with GitHub CLI. Run 'gh auth login' first.")
      throw new Error(`Failed to fetch PR info: ${msg}`)
    }
  }

  private async fetchPRBranch(
    info: PRInfo,
    parsed: { owner: string; repo: string; number: number },
    isFork: boolean,
    forkOwner: string | undefined,
  ): Promise<void> {
    if (isFork && forkOwner) {
      validateGitRef(forkOwner, "fork owner")
      validateGitRef(info.headRefName, "branch name")
      const remotes = await this.git.getRemotes()
      if (!remotes.some((r) => r.name === forkOwner)) {
        await this.git.addRemote(forkOwner, `https://github.com/${forkOwner}/${parsed.repo}.git`)
      }
      await this.gitExec(["fetch", forkOwner, info.headRefName])
    } else {
      validateGitRef(info.headRefName, "branch name")
      const ok = await this.gitTry(["fetch", "origin", info.headRefName])
      if (!ok) {
        await this.gitExec([
          "fetch",
          "origin",
          `+refs/pull/${parsed.number}/head:refs/remotes/origin/${info.headRefName}`,
        ])
      }
    }
  }

  private async exec(cmd: string, args: string[], timeout = 120000): Promise<string> {
    const { stdout } = await execWithShellEnv(cmd, args, { cwd: this.root, timeout })
    return stdout
  }

  private async gitExec(args: string[]): Promise<void> {
    await this.exec("git", args)
  }

  private async gitTry(args: string[]): Promise<boolean> {
    try {
      await this.gitExec(args)
      return true
    } catch {
      // Command failed — caller handles false return
      return false
    }
  }
}
