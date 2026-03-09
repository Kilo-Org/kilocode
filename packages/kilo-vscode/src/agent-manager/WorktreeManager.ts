/**
 * WorktreeManager - Manages git worktrees for agent sessions.
 *
 * Ported from kilocode/src/core/kilocode/agent-manager/WorktreeManager.ts.
 * Handles creation, discovery, and cleanup of worktrees stored in
 * {projectRoot}/.kilocode/worktrees/
 */

import * as path from "path"
import * as fs from "fs"
import simpleGit, { type SimpleGit } from "simple-git"
import { generateBranchName, sanitizeBranchName } from "./branch-name"
import type { GitOps } from "./GitOps"
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

export type { BranchListItem }
export { generateBranchName }

export interface WorktreeInfo {
  branch: string
  path: string
  parentBranch: string
  createdAt: number
  sessionId?: string
}

export type StartPointSource = "remote" | "local-tracking" | "local-branch" | "fallback"

export interface StartPointResult {
  ref: string
  branch: string
  source: StartPointSource
  warning?: string
}

export type WorktreeProgressStep = "syncing" | "verifying" | "fetching" | "creating"

export interface CreateWorktreeResult {
  branch: string
  path: string
  parentBranch: string
  startPointSource: StartPointSource
  startPointWarning?: string
}

export interface ExternalWorktreeItem {
  path: string
  branch: string
}

const KILOCODE_DIR = ".kilocode"
const SESSION_ID_FILE = "session-id"
const METADATA_FILE = "metadata.json"

export class WorktreeManager {
  private readonly root: string
  private readonly dir: string
  private readonly git: SimpleGit
  private readonly ops: GitOps | undefined
  private readonly log: (msg: string) => void

  constructor(root: string, log: (msg: string) => void, ops?: GitOps) {
    this.root = root
    this.dir = path.join(root, KILOCODE_DIR, "worktrees")
    this.git = simpleGit(root)
    this.ops = ops
    this.log = log
  }

  // ---------------------------------------------------------------------------
  // Per-project git operation mutex
  // ---------------------------------------------------------------------------

  // Serializes git-writing operations per repository root so concurrent
  // callers (e.g. multi-version worktree creation) don't hit index.lock
  // conflicts. Operations on different repositories proceed in parallel.
  private static locks = new Map<string, Promise<void>>()

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
    return this.withGitLock(() => this.createWorktreeImpl(params))
  }

  private async createWorktreeImpl(params: {
    prompt?: string
    existingBranch?: string
    baseBranch?: string
    branchName?: string
    onProgress?: (step: WorktreeProgressStep, message: string, detail?: string) => void
  }): Promise<CreateWorktreeResult> {
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

    // Resolve start point (parent branch)
    let parent: string
    let startPoint: StartPointResult | undefined

    if (params.existingBranch) {
      // Existing branch provided directly
      parent = params.existingBranch
      startPoint = {
        ref: params.existingBranch,
        branch: params.existingBranch,
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
    }

    const sanitized = params.branchName ? sanitizeBranchName(params.branchName) : undefined
    let branch = params.existingBranch ?? (sanitized || undefined) ?? generateBranchName(params.prompt || "agent-task")

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
      await this.git.raw(args)
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
      await this.git.raw(retryArgs)
    }

    this.log(`Created worktree: ${worktreePath} (branch: ${branch}, base: ${parent})`)
    return {
      branch,
      path: worktreePath,
      parentBranch: parent,
      startPointSource: startPoint.source,
      startPointWarning: startPoint.warning,
    }
  }

  /**
   * Remove a worktree directory and its git bookkeeping.
   * Called in two scenarios:
   * 1. Cleanup before re-creation in createWorktree (leftover from crash/interrupted creation)
   * 2. Future: session deletion from the Agent Manager UI
   *
   * Tries `git worktree remove` first to properly clean up .git/worktrees/ bookkeeping,
   * then --force for dirty worktrees, then falls back to fs.rm for orphaned directories
   * that git doesn't know about.
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    return this.withGitLock(() => this.removeWorktreeImpl(worktreePath))
  }

  private async removeWorktreeImpl(worktreePath: string): Promise<void> {
    const clean = await this.git.raw(["worktree", "remove", worktreePath]).then(
      () => true,
      () => false,
    )
    if (clean) {
      this.log(`Removed worktree: ${worktreePath}`)
      return
    }

    const forced = await this.git.raw(["worktree", "remove", "--force", worktreePath]).then(
      () => true,
      () => false,
    )
    if (forced) {
      this.log(`Force removed worktree: ${worktreePath}`)
      return
    }

    // Git doesn't know about this directory — remove it directly
    if (fs.existsSync(worktreePath)) {
      if (!this.isManagedPath(worktreePath)) {
        this.log(`Refusing to remove path outside worktrees directory: ${worktreePath}`)
        return
      }
      await fs.promises.rm(worktreePath, { recursive: true, force: true })
      this.log(`Removed orphaned worktree directory: ${worktreePath}`)
    }
  }

  async discoverWorktrees(): Promise<WorktreeInfo[]> {
    if (!fs.existsSync(this.dir)) return []

    const entries = await fs.promises.readdir(this.dir, { withFileTypes: true })
    const results = await Promise.all(
      entries.filter((e) => e.isDirectory()).map((e) => this.worktreeInfo(path.join(this.dir, e.name))),
    )
    return results.filter((info): info is WorktreeInfo => info !== undefined)
  }

  async writeMetadata(worktreePath: string, sessionId: string, parentBranch: string): Promise<void> {
    const dir = path.join(worktreePath, KILOCODE_DIR)
    if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true })

    // Write both formats: session-id for backward compat, metadata.json for parentBranch
    await Promise.all([
      fs.promises.writeFile(path.join(dir, SESSION_ID_FILE), sessionId, "utf-8"),
      fs.promises.writeFile(path.join(dir, METADATA_FILE), JSON.stringify({ sessionId, parentBranch }), "utf-8"),
    ])
    this.log(`Wrote metadata for session ${sessionId} to ${worktreePath}`)
    await this.ensureWorktreeExclude(worktreePath)
  }

  async readMetadata(worktreePath: string): Promise<{ sessionId: string; parentBranch?: string } | undefined> {
    const dir = path.join(worktreePath, KILOCODE_DIR)

    // Try metadata.json first (has parentBranch)
    try {
      const content = await fs.promises.readFile(path.join(dir, METADATA_FILE), "utf-8")
      const data = JSON.parse(content) as { sessionId?: string; parentBranch?: string }
      if (data.sessionId) return { sessionId: data.sessionId, parentBranch: data.parentBranch }
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
    await this.addExcludeEntry(excludePath, ".kilocode/worktrees/", "Kilo Code agent worktrees")
    await this.addExcludeEntry(excludePath, ".kilocode/agent-manager.json", "Kilo Agent Manager state")
    await this.addExcludeEntry(excludePath, ".kilocode/setup-script", "Kilo Code worktree setup script")
    await this.addExcludeEntry(excludePath, ".kilocode/setup-script.sh", "Kilo Code worktree setup script")
    await this.addExcludeEntry(excludePath, ".kilocode/setup-script.ps1", "Kilo Code worktree setup script")
    await this.addExcludeEntry(excludePath, ".kilocode/setup-script.cmd", "Kilo Code worktree setup script")
    await this.addExcludeEntry(excludePath, ".kilocode/setup-script.bat", "Kilo Code worktree setup script")
  }

  private async ensureWorktreeExclude(worktreePath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(path.join(worktreePath, ".git"), "utf-8")
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (!match) return

      const worktreeGitDir = path.resolve(worktreePath, match[1].trim())
      const mainGitDir = path.dirname(path.dirname(worktreeGitDir))
      await this.addExcludeEntry(
        path.join(mainGitDir, "info", "exclude"),
        `${KILOCODE_DIR}/`,
        "Kilo Code session metadata",
      )
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
      // Use persisted parentBranch if available, fall back to defaultBranch
      const parent = meta?.parentBranch ?? (await this.defaultBranch())
      return {
        branch: branch.trim(),
        path: wtPath,
        parentBranch: parent,
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

    // 1. Remote fetch
    if (await this.hasOriginRemote()) {
      onProgress?.("fetching", `Fetching origin/${branch}...`)
      try {
        await this.git.fetch("origin", branch)
        if (await this.refExistsLocally(`origin/${branch}`)) {
          return {
            ref: `origin/${branch}`,
            branch: branch,
            source: "remote",
          }
        }
      } catch (e) {
        this.log(`Failed to fetch origin/${branch}: ${e}`)
      }
    }

    // 2. Stale local tracking ref (offline fallback)
    if (await this.refExistsLocally(`origin/${branch}`)) {
      return {
        ref: `origin/${branch}`,
        branch: branch,
        source: "local-tracking",
        warning: "Used stale remote tracking branch (fetch failed)",
      }
    }

    // 3. Local branch
    if (await this.refExistsLocally(branch)) {
      return {
        ref: branch,
        branch: branch,
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

  async hasOriginRemote(): Promise<boolean> {
    try {
      const remotes = await this.git.getRemotes()
      return remotes.some((r: { name: string }) => r.name === "origin")
    } catch {
      // Git remotes unavailable — treat as no origin
      return false
    }
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

  async defaultBranch(): Promise<string> {
    // 1. Try symbolic-ref
    try {
      const head = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
      const match = head.trim().match(/refs\/remotes\/origin\/(.+)$/)
      if (match) return match[1]
    } catch (e) {
      this.log(`defaultBranch: symbolic-ref failed: ${e}`)
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
