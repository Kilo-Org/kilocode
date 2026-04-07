import * as nodePath from "path"
import * as os from "os"
import * as fs from "fs/promises"
import { spawn } from "../util/process"
import simpleGit from "simple-git"
import { parseWorktreeList, normalizePath } from "./git-import"

interface GitOpsOptions {
  log: (...args: unknown[]) => void
  /** Override git command execution for testing. */
  runGit?: (args: string[], cwd: string) => Promise<string>
}

export interface ApplyConflict {
  file?: string
  reason: string
}

interface ApplyCheckResult {
  ok: boolean
  conflicts: ApplyConflict[]
  message: string
}

interface ApplyPatchResult {
  ok: boolean
  conflicts: ApplyConflict[]
  message: string
}

interface ExecOptions {
  env?: NodeJS.ProcessEnv
  stdin?: string
}

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Build environment variables that prevent git and SSH from opening interactive
 * prompts. Used for background operations (e.g. periodic fetch) so users with
 * SSH keys that require passphrase confirmation are not bombarded with dialogs.
 *
 * Returns a full `process.env` overlay suitable for `simple-git.env()` or
 * `child_process.spawn`. `GIT_SSH_COMMAND` is only overridden when the user
 * hasn't already configured their own.
 */
export function nonInteractiveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  }
  if (!process.env.GIT_SSH_COMMAND) {
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes"
  }
  return env
}

export class GitOps {
  private readonly log: (...args: unknown[]) => void
  private readonly runGit: (args: string[], cwd: string) => Promise<string>

  constructor(options: GitOpsOptions) {
    this.log = options.log
    this.runGit =
      options.runGit ??
      ((args, cwd) =>
        simpleGit(cwd)
          .raw(args)
          .then((out) => out.trim()))
  }

  private raw(args: string[], cwd: string): Promise<string> {
    return this.runGit(args, cwd)
  }

  /** Return the name of the currently checked-out branch, or `"HEAD"` if detached. */
  async currentBranch(cwd: string): Promise<string> {
    return this.raw(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "")
  }

  /**
   * Resolve the remote name for a branch. Checks (in order):
   * 1. The configured upstream's remote (e.g. upstream from `upstream/main`)
   * 2. `branch.<name>.remote` config
   * 3. Falls back to `origin`
   */
  async resolveRemote(cwd: string, branch?: string): Promise<string> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd).catch(
      () => "",
    )
    if (upstream.includes("/")) return upstream.split("/")[0]

    const name = branch || (await this.raw(["branch", "--show-current"], cwd).catch(() => ""))
    if (name) {
      const configured = await this.raw(["config", `branch.${name}.remote`], cwd).catch(() => "")
      if (configured) return configured
    }

    return "origin"
  }

  /** Resolve the upstream tracking ref for `branch`, or `undefined` if none is set. Note: the `@{upstream}` check uses the current HEAD, not `branch`. */
  async resolveTrackingBranch(cwd: string, branch: string): Promise<string | undefined> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    if (upstream) return upstream

    const remote = await this.resolveRemote(cwd, branch)
    const ref = `${remote}/${branch}`
    const resolved = await this.raw(["rev-parse", "--verify", ref], cwd).catch(() => "")
    if (resolved) return ref

    return undefined
  }

  /** Resolve the repo's default branch via <remote>/HEAD. */
  async resolveDefaultBranch(cwd: string, branch?: string): Promise<string | undefined> {
    const remote = await this.resolveRemote(cwd, branch)
    const head = await this.raw(["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], cwd).catch(() => "")
    return head || undefined
  }

  async hasRemoteRef(cwd: string, ref: string): Promise<boolean> {
    return this.raw(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], cwd)
      .then(() => true)
      .catch(() => false)
  }

  /** Return the set of worktree paths for the repo, excluding bare entries. */
  async listWorktreePaths(cwd: string): Promise<Map<string, string>> {
    const raw = await this.raw(["worktree", "list", "--porcelain"], cwd)
    const result = new Map<string, string>()
    for (const entry of parseWorktreeList(raw)) {
      if (entry.bare) continue
      result.set(normalizePath(entry.path), entry.branch)
    }
    return result
  }

  /**
   * Compute working-tree stats (staged + unstaged + untracked) without requiring
   * a remote or base branch. Combines `git diff HEAD --numstat` for tracked
   * changes with `git ls-files --others` for new files.
   *
   * Returns aggregate file count, additions, and deletions across the working tree.
   */
  async workingTreeStats(cwd: string): Promise<{ files: number; additions: number; deletions: number }> {
    // Single diff against HEAD captures both staged and unstaged changes.
    const [numstat, untracked] = await Promise.all([
      this.raw(["diff", "HEAD", "--numstat"], cwd).catch(() => ""),
      this.raw(["ls-files", "--others", "--exclude-standard"], cwd).catch(() => ""),
    ])

    const tracked = numstat
      ? numstat.split("\n").reduce(
          (acc, line) => {
            if (!line.trim()) return acc
            const parts = line.split("\t")
            return {
              files: acc.files + 1,
              additions: acc.additions + (parts[0] !== "-" ? parseInt(parts[0], 10) || 0 : 0),
              deletions: acc.deletions + (parts[1] !== "-" ? parseInt(parts[1], 10) || 0 : 0),
            }
          },
          { files: 0, additions: 0, deletions: 0 },
        )
      : { files: 0, additions: 0, deletions: 0 }

    // Count lines in untracked files as additions. Cap at 1MB to avoid
    // reading large binary files into memory.
    if (!untracked) return tracked

    const paths = untracked.split("\n").filter((line) => line.trim())
    const counts = await Promise.all(
      paths.map(async (p) => {
        try {
          const full = nodePath.resolve(cwd, p)
          const stat = await fs.stat(full)
          if (stat.size > 1_000_000) return 0
          const content = await fs.readFile(full, "utf-8")
          return content.split("\n").length
        } catch (err) {
          this.log(`Failed to read untracked file ${p}:`, err)
          return 0
        }
      }),
    )

    return {
      files: tracked.files + paths.length,
      additions: tracked.additions + counts.reduce((sum, count) => sum + count, 0),
      deletions: tracked.deletions,
    }
  }

  /**
   * Count commits ahead and behind using `rev-list --left-right --count`.
   * Callers are expected to pass a fully-qualified ref (e.g. "origin/main").
   * Counts are computed against local tracking refs only — no fetch is
   * performed, so values may be stale until an explicit git operation
   * (push, pull, etc.) updates the refs.
   */
  async aheadBehind(cwd: string, base: string): Promise<{ ahead: number; behind: number }> {
    return this.parseLeftRight(cwd, base)
  }

  private async parseLeftRight(cwd: string, ref: string): Promise<{ ahead: number; behind: number }> {
    const out = await this.raw(["rev-list", "--left-right", "--count", `${ref}...HEAD`], cwd).catch(() => "0\t0")
    const [behind, ahead] = out.split(/\s+/).map((s) => parseInt(s, 10) || 0)
    return { ahead, behind }
  }

  /**
   * Build a binary-safe patch of all working-tree changes relative to the
   * merge-base with `baseBranch`. Optionally scoped to `selectedFiles`.
   */
  async buildWorktreePatch(sourcePath: string, baseBranch: string, selectedFiles?: string[]): Promise<string> {
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "kilo-apply-"))
    const index = nodePath.join(tmp, "index")
    const env = { ...process.env, GIT_INDEX_FILE: index }
    const files = (selectedFiles ?? [])
      .map((file) => file.trim())
      .filter((file) => file.length > 0 && !nodePath.isAbsolute(file) && !file.split(/[\\/]/).includes(".."))
    const pathspec = files.length > 0 ? files : ["."]

    try {
      const base = (await this.raw(["merge-base", "HEAD", baseBranch], sourcePath)).trim()
      const baseTree = (await this.raw(["rev-parse", `${base}^{tree}`], sourcePath)).trim()

      const read = await this.exec(["read-tree", "HEAD"], sourcePath, { env })
      if (read.code !== 0) {
        throw new Error(read.stderr.trim() || "Failed to initialize temporary index")
      }

      const add = await this.exec(["add", "-A", "--", ...pathspec], sourcePath, { env })
      if (add.code !== 0) {
        throw new Error(add.stderr.trim() || "Failed to stage worktree snapshot")
      }

      const treeResult = await this.exec(["write-tree"], sourcePath, { env })
      if (treeResult.code !== 0) {
        throw new Error(treeResult.stderr.trim() || "Failed to snapshot worktree index")
      }

      const tree = treeResult.stdout.trim()
      const diff = await this.exec(
        ["diff", "--binary", "--full-index", "--find-renames", "--no-color", baseTree, tree],
        sourcePath,
      )
      if (diff.code !== 0) {
        throw new Error(diff.stderr.trim() || "Failed to generate patch")
      }

      return diff.stdout
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }

  async checkApplyPatch(targetPath: string, patch: string): Promise<ApplyCheckResult> {
    if (!patch.trim()) {
      return { ok: true, conflicts: [], message: "No changes to apply" }
    }

    const result = await this.exec(["apply", "--3way", "--check", "--whitespace=nowarn", "-"], targetPath, {
      stdin: patch,
    })
    if (result.code === 0) {
      return { ok: true, conflicts: [], message: "Patch applies cleanly" }
    }

    const output = [result.stderr, result.stdout].filter(Boolean).join("\n")
    const message = output.trim() || "Patch does not apply cleanly"
    const conflicts = this.parseApplyConflicts(output)
    return { ok: false, conflicts, message }
  }

  async applyPatch(targetPath: string, patch: string): Promise<ApplyPatchResult> {
    if (!patch.trim()) {
      return { ok: true, conflicts: [], message: "No changes to apply" }
    }

    const result = await this.exec(["apply", "--3way", "--whitespace=nowarn", "-"], targetPath, { stdin: patch })
    if (result.code === 0) {
      return { ok: true, conflicts: [], message: "Patch applied" }
    }

    const output = [result.stderr, result.stdout].filter(Boolean).join("\n")
    const message = output.trim() || "Failed to apply patch"
    const conflicts = this.parseApplyConflicts(output)
    return { ok: false, conflicts, message }
  }

  private parseApplyConflicts(output: string): ApplyConflict[] {
    const lines = output
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)

    const seen = new Set<string>()
    const conflicts: ApplyConflict[] = []

    for (const line of lines) {
      const patchFailed = /^error:\s+patch failed:\s+(.+?):\d+$/i.exec(line)
      if (patchFailed) {
        const file = patchFailed[1]!
        const reason = "patch failed"
        const key = `${file}:${reason}`
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({ file, reason })
        continue
      }

      const fileReason =
        /^error:\s+(.+?):\s+(does not match index|patch does not apply|cannot read the current contents.*)$/i.exec(line)
      if (fileReason) {
        const file = fileReason[1]!
        const reason = fileReason[2]!
        const key = `${file}:${reason}`
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({ file, reason })
        continue
      }
    }

    if (conflicts.length > 0) return conflicts
    const first = lines[0]
    if (first) return [{ reason: first }]
    return [{ reason: "Patch does not apply cleanly" }]
  }

  private exec(args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd,
        env: options?.env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      if (options?.stdin !== undefined) {
        if (!child.stdin) {
          resolve({ code: 1, stdout: "", stderr: "stdin not available for git process" })
          return
        }
        child.stdin.end(options.stdin)
      }

      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
      child.stderr?.on("data", (chunk: Buffer) => err.push(chunk))

      child.on("error", (error) => {
        resolve({ code: 1, stdout: "", stderr: error.message })
      })
      child.on("close", (code) => {
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        })
      })
    })
  }
}
