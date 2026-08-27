import * as nodePath from "path"
import * as os from "os"
import * as fs from "fs/promises"
import { spawn } from "../util/process"
import type { GitExecutable } from "../util/git-executable"
import simpleGit from "simple-git"
import {
  parseWorktreeList,
  normalizePath,
  parseForEachRefOutput,
  buildBranchList,
  type BranchListItem,
} from "./git-import"
import type { Semaphore } from "./semaphore"

interface GitOpsOptions {
  log: (...args: unknown[]) => void
  /** Override git command execution for testing. */
  runGit?: (args: string[], cwd: string) => Promise<string>
  /** Shared concurrency gate for child process spawning. */
  semaphore?: Semaphore
  /** Validated Git executable shared by Agent Manager operations. */
  binary?: GitExecutable | string
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
  timeout?: number
  signal?: AbortSignal
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecBufferResult {
  code: number
  stdout: Buffer
  stderr: string
}

/**
 * Fixed SSH command injected by {@link nonInteractiveEnv} when the user has
 * not already configured their own. Exported so callers can check whether a
 * `GIT_SSH_COMMAND` originated from Kilo (safe) or was inherited from the
 * parent process (untrusted).
 */
export const KILO_NON_INTERACTIVE_SSH_COMMAND = "ssh -o BatchMode=yes"

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
    env.GIT_SSH_COMMAND = KILO_NON_INTERACTIVE_SSH_COMMAND
  }
  delete env.GIT_CONFIG_COUNT
  delete env.SSH_ASKPASS
  delete env.GIT_ASKPASS
  delete env.EDITOR
  delete env.GIT_EDITOR
  delete env.GIT_SEQUENCE_EDITOR
  delete env.PAGER
  delete env.GIT_PAGER
  delete env.GIT_SSH
  delete env.GIT_CONFIG_GLOBAL
  delete env.GIT_CONFIG_SYSTEM
  delete env.GIT_CONFIG
  delete env.GIT_PROXY_COMMAND
  delete env.GIT_EXTERNAL_DIFF
  delete env.GIT_TEMPLATE_DIR
  delete env.GIT_EXEC_PATH
  delete env.PREFIX
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) {
      delete env[key]
    }
  }
  return env
}

/**
 * True when `env.GIT_SSH_COMMAND` is the fixed value Kilo sets, rather than
 * an inherited one from the parent process. Use this to decide whether it's
 * safe to pass `allowUnsafeSshCommand: true` to simple-git.
 */
export function isKiloOwnedSshCommand(env: NodeJS.ProcessEnv): boolean {
  return env.GIT_SSH_COMMAND === KILO_NON_INTERACTIVE_SSH_COMMAND
}

export class GitOps {
  private readonly log: (...args: unknown[]) => void
  private readonly runGit: (args: string[], cwd: string) => Promise<string>
  private readonly controller = new AbortController()
  private readonly semaphore: Semaphore | undefined
  private readonly binary: GitExecutable
  private readonly injected: boolean
  private executableCache: Promise<string> | undefined
  private readonly resolutionCache = new Map<string, { value: string; expires: number }>()
  private static readonly CACHE_TTL_MS = 60000
  private static readonly DEFAULT_BRANCH_CACHE_TTL_MS = 10 * 60_000
  private static readonly MAX_CACHE_SIZE = 100

  public readonly path: string

  get disposed(): boolean {
    return this.controller.signal.aborted
  }

  constructor(options: GitOpsOptions) {
    this.log = options.log
    this.semaphore = options.semaphore
    const configured = options.binary
    this.path = typeof configured === "string" ? configured : "git"
    this.binary =
      typeof configured === "string"
        ? () => Promise.resolve(configured)
        : (configured ?? (() => Promise.resolve("git")))
    this.injected = options.runGit !== undefined
    this.runGit =
      options.runGit ??
      (async (args, cwd) => {
        const binary = await this.executable()
        return simpleGit(cwd, {
          abort: this.controller.signal,
          binary,
          unsafe: { allowUnsafeCustomBinary: binary !== "git" },
        })
          .raw(args)
          .then((out) => out.trim())
      })
  }

  dispose(): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort()
    }
    this.resolutionCache.clear()
  }

  private getCached(key: string): string | undefined {
    const entry = this.resolutionCache.get(key)
    if (entry && entry.expires > Date.now()) {
      return entry.value
    }
    return undefined
  }

  private setCached(key: string, value: string, ttl = GitOps.CACHE_TTL_MS): void {
    if (this.resolutionCache.size >= GitOps.MAX_CACHE_SIZE) {
      let oldestKey: string | undefined
      let oldestExpiry = Infinity
      for (const [k, v] of this.resolutionCache) {
        if (v.expires < oldestExpiry) {
          oldestExpiry = v.expires
          oldestKey = k
        }
      }
      if (oldestKey) this.resolutionCache.delete(oldestKey)
    }
    this.resolutionCache.set(key, { value, expires: Date.now() + ttl })
  }

  private raw(args: string[], cwd: string): Promise<string> {
    const signal = this.controller.signal
    if (signal.aborted) return Promise.reject(new Error("GitOps disposed"))
    return this.executable().then(() => {
      if (signal.aborted) throw new Error("GitOps disposed")
      const invoke = () => {
        const pending = this.runGit(args, cwd)
        if (!this.injected) return pending
        return new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new Error("GitOps disposed"))
          signal.addEventListener("abort", onAbort, { once: true })
          pending.then(
            (value) => {
              signal.removeEventListener("abort", onAbort)
              resolve(value)
            },
            (err) => {
              signal.removeEventListener("abort", onAbort)
              reject(err)
            },
          )
        })
      }
      return this.semaphore ? this.semaphore.run(invoke) : invoke()
    })
  }

  /** Return the name of the currently checked-out branch, or `"HEAD"` if detached. */
  async currentBranch(cwd: string): Promise<string> {
    return this.raw(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "")
  }

  async root(cwd: string): Promise<string | undefined> {
    return this.raw(["rev-parse", "--show-toplevel"], cwd).catch(() => undefined)
  }

  /**
   * Resolve the remote name for a branch. Checks (in order):
   * 1. The configured upstream's remote (e.g. upstream from `upstream/main`)
   * 2. `branch.<name>.remote` config
   * 3. Falls back to `origin`
   */
  async resolveRemote(cwd: string, branch?: string): Promise<string> {
    const cacheKey = `remote:${cwd}:${branch}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd).catch(
      () => "",
    )
    if (upstream.includes("/")) {
      const result = upstream.split("/")[0]
      this.setCached(cacheKey, result)
      return result
    }

    const name = branch || (await this.raw(["branch", "--show-current"], cwd).catch(() => ""))
    if (name) {
      const configured = await this.raw(["config", `branch.${name}.remote`], cwd).catch(() => "")
      if (configured) {
        this.setCached(cacheKey, configured)
        return configured
      }
    }

    const result = "origin"
    this.setCached(cacheKey, result)
    return result
  }

  /** Resolve the upstream tracking ref for `branch`, or `undefined` if none is set. Note: the `@{upstream}` check uses the current HEAD, not `branch`. */
  async resolveTrackingBranch(cwd: string, branch: string): Promise<string | undefined> {
    const cacheKey = `tracking:${cwd}:${branch}`
    const cached = this.getCached(cacheKey)
    if (cached !== undefined) return cached === "" ? undefined : cached

    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    if (upstream) {
      this.setCached(cacheKey, upstream)
      return upstream
    }

    const remote = await this.resolveRemote(cwd, branch)
    const ref = `${remote}/${branch}`
    const resolved = await this.raw(["rev-parse", "--verify", ref], cwd).catch(() => "")
    if (resolved) {
      this.setCached(cacheKey, ref)
      return ref
    }

    this.setCached(cacheKey, "")
    return undefined
  }

  /** Resolve the repo's default branch from the remote, then local <remote>/HEAD. */
  async resolveDefaultBranch(cwd: string, branch?: string): Promise<string | undefined> {
    const remote = await this.resolveRemote(cwd, branch)
    const cacheKey = `default-branch:${cwd}:${remote}`
    const cached = this.getCached(cacheKey)
    if (cached !== undefined) return cached === "" ? undefined : cached

    const advertised = await this.remoteHead(cwd, remote)
    const match = advertised.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/m)
    const current = match?.[1] ? `${remote}/${match[1]}` : undefined
    const local = current
      ? ""
      : await this.raw(["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], cwd).catch(() => "")
    const result = current || local || undefined
    this.setCached(cacheKey, result ?? "", GitOps.DEFAULT_BRANCH_CACHE_TTL_MS)
    return result
  }

  private async remoteHead(cwd: string, remote: string): Promise<string> {
    const args = ["ls-remote", "--symref", remote, "HEAD"]
    if (this.injected) return this.raw(args, cwd).catch(() => "")

    const result = await this.exec(args, cwd, { env: nonInteractiveEnv(), timeout: 5000 })
    return result.code === 0 ? result.stdout.trim() : ""
  }

  async hasRemoteRef(cwd: string, ref: string): Promise<boolean> {
    return this.raw(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], cwd)
      .then(() => true)
      .catch(() => false)
  }

  /**
   * List local branches and `origin/*` remotes sorted by last commit date,
   * with the resolved default branch flagged. Mirrors WorktreeManager's
   * `listBranches` shape but takes `cwd` per call so it works outside the
   * worktree context (e.g. for the diff viewer's base branch picker).
   */
  async listBranches(cwd: string): Promise<{ branches: BranchListItem[]; defaultBranch: string }> {
    const def = (await this.resolveDefaultBranch(cwd)) ?? ""
    const raw = await this.raw(
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)\t%(committerdate:iso-strict)",
        "refs/heads/",
        "refs/remotes/origin/",
      ],
      cwd,
    ).catch((err) => {
      this.log("listBranches: for-each-ref failed", err instanceof Error ? err.message : String(err))
      return ""
    })
    const { locals, remotes, dates } = parseForEachRefOutput(raw)
    return { branches: buildBranchList(locals, remotes, dates, def), defaultBranch: def }
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

  /**
   * Revert a single file in a worktree back to the merge-base state.
   * For modified/deleted files: restores the file from the merge-base commit.
   * For added (new) files: removes the file from the worktree.
   */
  async revertFile(
    cwd: string,
    baseBranch: string,
    file: string,
    status?: "added" | "deleted" | "modified",
  ): Promise<{ ok: boolean; message: string }> {
    // Validate path: no absolute paths, no ".." traversal
    if (nodePath.isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
      return { ok: false, message: "Invalid file path" }
    }

    const base = (await this.raw(["merge-base", "HEAD", baseBranch], cwd).catch(() => "")).trim()
    if (!base) {
      return { ok: false, message: "Could not resolve merge-base" }
    }

    if (status === "added") {
      // New file — remove it from disk and unstage
      const full = nodePath.resolve(cwd, file)
      const root = await fs.realpath(cwd)
      const resolved = await fs.realpath(full).catch(() => full)
      if (resolved !== root && !resolved.startsWith(root + nodePath.sep)) {
        return { ok: false, message: "File path outside worktree" }
      }
      await fs.rm(full, { force: true })
      // Also remove from git index in case it was staged
      await this.raw(["rm", "--cached", "--force", "--ignore-unmatch", "--", file], cwd).catch(() => "")
      return { ok: true, message: "Removed added file" }
    }

    // Modified or deleted file — restore from merge-base
    const result = await this.exec(["checkout", base, "--", file], cwd)
    if (result.code !== 0) {
      return { ok: false, message: result.stderr.trim() || "Failed to revert file" }
    }
    // Only unstage for modified files. For deleted files the checkout already
    // restored the file into the index correctly — resetting to HEAD would drop
    // it from the index and make it appear as a new untracked file.
    if (status === "modified") {
      await this.raw(["reset", "HEAD", "--", file], cwd).catch(() => "")
    }
    return { ok: true, message: "Reverted file to base" }
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

  /**
   * Run a git command returning `{code, stdout, stderr}`. Gated by the shared
   * semaphore and respects the dispose abort signal. Never throws — commands
   * with non-zero exit codes resolve normally (nothrow semantics), making this
   * suitable for callers that need to tolerate legitimate failures (e.g.
   * `merge-base` on an orphan branch, `ls-files --error-unmatch`).
   */
  execGit(args: string[], cwd: string, options?: { stdin?: string; signal?: AbortSignal }): Promise<ExecResult> {
    return this.exec(args, cwd, options)
  }

  execGitBuffer(args: string[], cwd: string, options?: { signal?: AbortSignal }): Promise<ExecBufferResult> {
    return this.execBuffer(args, cwd, options)
  }

  private async exec(args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.execBuffer(args, cwd, options)
    return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr }
  }

  private async execBuffer(args: string[], cwd: string, options?: ExecOptions): Promise<ExecBufferResult> {
    if (this.controller.signal.aborted) {
      return { code: 1, stdout: Buffer.alloc(0), stderr: "GitOps disposed" }
    }
    const cmd = await this.executable().catch(() => undefined)
    if (!cmd || this.controller.signal.aborted) {
      return { code: 1, stdout: Buffer.alloc(0), stderr: "GitOps disposed" }
    }
    const invoke = () => this.invoke(cmd, args, cwd, options)
    return this.semaphore ? this.semaphore.run(invoke, options?.signal) : invoke()
  }

  private executable(): Promise<string> {
    const signal = this.controller.signal
    if (signal.aborted) return Promise.reject(new Error("GitOps disposed"))

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => reject(new Error("GitOps disposed"))
      signal.addEventListener("abort", onAbort, { once: true })
      const cache = (this.executableCache ??= Promise.resolve().then(() => this.binary()))
      cache.then(
        (value) => {
          signal.removeEventListener("abort", onAbort)
          resolve(value)
        },
        (err) => {
          signal.removeEventListener("abort", onAbort)
          if (this.executableCache === cache) this.executableCache = undefined
          reject(err)
        },
      )
    })
  }

  private invoke(cmd: string, args: string[], cwd: string, options?: ExecOptions): Promise<ExecBufferResult> {
    if (this.controller.signal.aborted || options?.signal?.aborted) {
      return Promise.resolve({ code: 1, stdout: Buffer.alloc(0), stderr: "GitOps disposed" })
    }

    return new Promise<ExecBufferResult>((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        env: options?.env,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let failure: string | undefined
      const abort = () => child.kill("SIGTERM")
      const timeout = options?.timeout
        ? setTimeout(() => {
            failure = `Git command timed out after ${options.timeout}ms`
            child.kill("SIGTERM")
          }, options.timeout)
        : undefined

      this.controller.signal.addEventListener("abort", abort, { once: true })
      options?.signal?.addEventListener("abort", abort, { once: true })
      child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
      child.stderr?.on("data", (chunk: Buffer) => err.push(chunk))

      child.on("error", (error) => {
        failure = error.message
      })
      child.on("close", (code) => {
        if (timeout) clearTimeout(timeout)
        this.controller.signal.removeEventListener("abort", abort)
        options?.signal?.removeEventListener("abort", abort)
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(out),
          stderr: failure ?? Buffer.concat(err).toString("utf8"),
        })
      })

      if (options?.stdin === undefined) return
      if (child.stdin) {
        child.stdin.end(options.stdin)
        return
      }
      failure = "stdin not available for git process"
      child.kill("SIGTERM")
    })
  }
}
