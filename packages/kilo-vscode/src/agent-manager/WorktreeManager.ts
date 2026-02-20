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
import { generateBranchName } from "./branch-name"

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

const KILOCODE_DIR = ".kilocode"
const SESSION_ID_FILE = "session-id"
const METADATA_FILE = "metadata.json"

export class WorktreeManager {
  private readonly root: string
  private readonly dir: string
  private readonly git: SimpleGit
  private readonly log: (msg: string) => void

  constructor(root: string, log: (msg: string) => void) {
    this.root = root
    this.dir = path.join(root, KILOCODE_DIR, "worktrees")
    this.git = simpleGit(root)
    this.log = log
  }

  async createWorktree(params: { prompt?: string; existingBranch?: string }): Promise<CreateWorktreeResult> {
    const repo = await this.git.checkIsRepo()
    if (!repo) throw new Error("Workspace is not a git repository")

    await this.ensureDir()
    await this.ensureGitExclude()

    const parent = await this.currentBranch()
    let branch = params.existingBranch ?? generateBranchName(params.prompt || "agent-task")

    if (params.existingBranch) {
      const exists = await this.branchExists(branch)
      if (!exists) throw new Error(`Branch "${branch}" does not exist`)
    }

    let worktreePath = path.join(this.dir, branch)

    if (fs.existsSync(worktreePath)) {
      this.log(`Worktree directory exists, cleaning up before re-creation: ${worktreePath}`)
      await this.removeWorktree(worktreePath)
    }

    try {
      const args = params.existingBranch
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath]
      await this.git.raw(args)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes("already exists") || params.existingBranch) {
        throw new Error(`Failed to create worktree: ${msg}`)
      }
      // Branch name collision -- retry with unique suffix
      branch = `${branch}-${Date.now()}`
      worktreePath = path.join(this.dir, branch)
      await this.git.raw(["worktree", "add", "-b", branch, worktreePath])
    }

    this.log(`Created worktree: ${worktreePath} (branch: ${branch})`)
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
      if (!worktreePath.startsWith(this.dir)) {
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
    return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim()
  }

  private async branchExists(name: string): Promise<boolean> {
    try {
      const branches = await this.git.branch()
      return branches.all.includes(name) || branches.all.includes(`remotes/origin/${name}`)
    } catch {
      return false
    }
  }

  private async defaultBranch(): Promise<string> {
    try {
      const head = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
      const match = head.trim().match(/refs\/remotes\/origin\/(.+)$/)
      if (match) return match[1]
    } catch {}

    try {
      const branches = await this.git.branch()
      if (branches.all.includes("main")) return "main"
      if (branches.all.includes("master")) return "master"
    } catch {}

    return "main"
  }
}
