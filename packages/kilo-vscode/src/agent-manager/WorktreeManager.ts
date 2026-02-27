/**
 * WorktreeManager - Manages git worktrees for agent sessions.
 *
 * Ported from kilocode/src/core/kilocode/agent-manager/WorktreeManager.ts.
 * Handles creation, discovery, and cleanup of worktrees stored in
 * {projectRoot}/.kilocode/worktrees/
 */

import * as path from "path"
import * as fs from "fs"
import * as cp from "child_process"
import simpleGit, { type SimpleGit } from "simple-git"
import { generateBranchName, sanitizeBranchName } from "./branch-name"
import type { GitOps } from "./GitOps"
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

export interface CreateWorktreeResult {
  branch: string
  path: string
  parentBranch: string
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

  async createWorktree(params: {
    prompt?: string
    existingBranch?: string
    baseBranch?: string
    branchName?: string
  }): Promise<CreateWorktreeResult> {
    const repo = await this.git.checkIsRepo()
    if (!repo)
      throw new Error(
        "This folder is not a git repository. Initialize a repository or open a git project to use worktrees.",
      )

    await this.ensureDir()
    await this.ensureGitExclude()

    const parent = params.baseBranch || (await this.currentBranch())

    // Validate baseBranch exists if explicitly provided
    if (params.baseBranch) {
      const exists = await this.branchExists(params.baseBranch)
      if (!exists) throw new Error(`Base branch "${params.baseBranch}" does not exist`)
      // Check if the base branch is a remote-only branch and fetch it
      const branches = await this.git.branch()
      if (!branches.all.includes(params.baseBranch) && branches.all.includes(`remotes/origin/${params.baseBranch}`)) {
        await this.git.fetch("origin", params.baseBranch)
      }
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
      await this.removeWorktree(worktreePath)
    }

    try {
      const args = params.existingBranch
        ? ["worktree", "add", worktreePath, branch]
        : params.baseBranch
          ? ["worktree", "add", "-b", branch, worktreePath, params.baseBranch]
          : ["worktree", "add", "-b", branch, worktreePath]
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
      const retryArgs = params.baseBranch
        ? ["worktree", "add", "-b", branch, worktreePath, params.baseBranch]
        : ["worktree", "add", "-b", branch, worktreePath]
      await this.git.raw(retryArgs)
    }

    this.log(`Created worktree: ${worktreePath} (branch: ${branch}, base: ${parent})`)
    return { branch, path: worktreePath, parentBranch: parent }
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
      const data = JSON.parse(content)
      if (data.sessionId) return { sessionId: data.sessionId, parentBranch: data.parentBranch }
    } catch {
      // Fall back to session-id file
    }

    // Legacy: plain text session-id file
    try {
      const content = await fs.promises.readFile(path.join(dir, SESSION_ID_FILE), "utf-8")
      const id = content.trim()
      if (id) return { sessionId: id }
    } catch {
      // No metadata
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
    } catch {
      return false
    }
  }

  async defaultBranch(): Promise<string> {
    if (this.ops) {
      const remote = await this.ops.resolveRemote(this.root)
      const resolved = await this.ops.resolveDefaultBranch(this.root)
      if (resolved) {
        const prefix = `${remote}/`
        return resolved.startsWith(prefix) ? resolved.slice(prefix.length) : resolved
      }
    } else {
      try {
        const head = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
        const match = head.trim().match(/refs\/remotes\/origin\/(.+)$/)
        if (match) return match[1]
      } catch {}
    }

    try {
      const branches = await this.git.branch()
      if (branches.all.includes("main")) return "main"
      if (branches.all.includes("master")) return "master"
    } catch {}

    return "main"
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

    return this.createWorktree({ existingBranch: branch })
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

  private exec(cmd: string, args: string[], timeout = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile(cmd, args, { cwd: this.root, timeout, encoding: "utf-8" }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      })
    })
  }

  private async gitExec(args: string[]): Promise<void> {
    await this.exec("git", args)
  }

  private async gitTry(args: string[]): Promise<boolean> {
    try {
      await this.gitExec(args)
      return true
    } catch {
      return false
    }
  }
}
