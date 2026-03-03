import * as nodePath from "path"
import * as os from "os"
import * as cp from "child_process"
import * as fs from "fs/promises"
import simpleGit from "simple-git"

export interface GitOpsOptions {
  log: (...args: unknown[]) => void
  refreshMs?: number
  /** Override git command execution for testing. */
  runGit?: (args: string[], cwd: string) => Promise<string>
}

export interface ApplyConflict {
  file?: string
  reason: string
}

export interface ApplyCheckResult {
  ok: boolean
  conflicts: ApplyConflict[]
  message: string
}

export interface ApplyPatchResult {
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

export class GitOps {
  private lastFetch = new Map<string, number>()
  private inflightFetch = new Map<string, Promise<void>>()
  private readonly refreshMs: number
  private readonly log: (...args: unknown[]) => void
  private readonly runGit: (args: string[], cwd: string) => Promise<string>

  constructor(options: GitOpsOptions) {
    this.refreshMs = options.refreshMs ?? 120000
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

  async refreshRemote(cwd: string, remote: string): Promise<void> {
    if (!remote) return

    const commonRaw = await this.raw(["rev-parse", "--git-common-dir"], cwd).catch(() => cwd)
    const common = nodePath.isAbsolute(commonRaw) ? commonRaw : nodePath.resolve(cwd, commonRaw)
    const key = `${common}:${remote}`

    const existing = this.inflightFetch.get(key)
    if (existing) return existing

    const prev = this.lastFetch.get(key) ?? 0
    const now = Date.now()
    if (now - prev < this.refreshMs) return
    this.lastFetch.set(key, now)

    const job = this.raw(["fetch", "--quiet", "--no-tags", remote], cwd)
      .catch((err) => {
        this.log(`Failed to refresh remote refs for ${cwd}:`, err)
      })
      .then(() => undefined)
      .finally(() => {
        this.inflightFetch.delete(key)
      })
    this.inflightFetch.set(key, job)
    return job
  }

  /**
   * Compute working-tree stats (staged + unstaged + untracked) without requiring
   * a remote or base branch — mirrors the superset approach of running
   * `git diff --numstat` and `git ls-files --others`.
   */
  async workingTreeStats(cwd: string): Promise<{ files: number; additions: number; deletions: number }> {
    // Staged + unstaged changes relative to HEAD (like superset's dual
    // git diff --cached --numstat + git diff --numstat, combined).
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

    // Count lines in untracked files as additions (like superset's
    // applyUntrackedLineCount). Cap at 1MB to avoid reading huge binaries.
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
   * Count commits ahead and behind in a single `rev-list --left-right --count`
   * call (like superset's approach). Falls back through upstream → remote/branch
   * → remote/parentBranch → parentBranch.
   */
  async aheadBehind(cwd: string, parentBranch: string): Promise<{ ahead: number; behind: number }> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    const branch = await this.raw(["branch", "--show-current"], cwd).catch(() => "")
    const remote = await this.resolveRemote(cwd, branch)
    await this.refreshRemote(cwd, remote)

    const ref = (() => {
      if (upstream) return upstream
      const remoteBranch = branch ? `${remote}/${branch}` : ""
      // hasRemoteRef is async, so we can't use it inline — resolve below
      return { remoteBranch, remoteParent: `${remote}/${parentBranch}`, parentBranch }
    })()

    if (typeof ref === "string") {
      return this.parseLeftRight(cwd, ref)
    }

    if (ref.remoteBranch && (await this.hasRemoteRef(cwd, ref.remoteBranch))) {
      return this.parseLeftRight(cwd, ref.remoteBranch)
    }
    if (await this.hasRemoteRef(cwd, ref.remoteParent)) {
      return this.parseLeftRight(cwd, ref.remoteParent)
    }
    return this.parseLeftRight(cwd, ref.parentBranch)
  }

  private async parseLeftRight(cwd: string, ref: string): Promise<{ ahead: number; behind: number }> {
    const out = await this.raw(["rev-list", "--left-right", "--count", `${ref}...HEAD`], cwd).catch(() => "0\t0")
    const [behind, ahead] = out.split(/\s+/).map((s) => parseInt(s, 10) || 0)
    return { ahead, behind }
  }

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
      const child = cp.execFile(
        "git",
        args,
        {
          cwd,
          env: options?.env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout, stderr })
            return
          }
          const exec = error as cp.ExecException
          const code = typeof exec.code === "number" ? exec.code : 1
          const fallback = exec.message || "Git command failed"
          resolve({ code, stdout: stdout ?? "", stderr: stderr || fallback })
        },
      )

      if (options?.stdin !== undefined) {
        if (!child.stdin) {
          resolve({ code: 1, stdout: "", stderr: "stdin not available for git process" })
          return
        }
        child.stdin.end(options.stdin)
      }
    })
  }
}
